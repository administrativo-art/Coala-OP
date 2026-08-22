/**
 * Backfill idempotente da arquitetura de obrigações financeiras.
 *
 * Seguro por padrão: somente leitura e relatório. A escrita exige --execute.
 * As leituras são paginadas e possuem limite rígido para evitar varreduras
 * acidentais sem controle de custo.
 *
 * Uso:
 *   npm run migrate:financial-obligations
 *   npm run migrate:financial-obligations -- --max-docs=5000
 *   npm run migrate:financial-obligations -- --execute --max-docs=5000
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

if (process.argv.includes("--help")) {
  console.log("migrate-financial-obligations [--execute] [--max-docs=N]");
  process.exit(0);
}

config({ path: ".env.local" });

const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");
const { dbAdmin } = await import("../src/lib/firebase-admin");
const { calculateFinancialObligationSummary, moneyToCents } = await import("../src/features/financial/obligations/calculations");

type Row = { id: string; data: Record<string, any>; ref: FirebaseFirestore.DocumentReference };
type Change = { ref: FirebaseFirestore.DocumentReference; collection: string; id: string; patch: Record<string, any> };

const execute = process.argv.includes("--execute");
const maxDocsArgument = process.argv.find((argument) => argument.startsWith("--max-docs="));
const maxDocs = Math.min(20_000, Math.max(1, Number(maxDocsArgument?.split("=")[1] || 5_000)));
const pageSize = 200;

function safeKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function dateValue(value: unknown) {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = value ? new Date(value as string | number | Date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function competenceKey(expense: Record<string, any>) {
  if (/^\d{4}-\d{2}$/.test(String(expense.provisionCompetence || ""))) return expense.provisionCompetence;
  const date = dateValue(expense.competenceDate);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : null;
}

async function readBounded(collection: FirebaseFirestore.CollectionReference, label: string) {
  const rows: Row[] = [];
  let lastId: string | null = null;
  while (rows.length < maxDocs) {
    let query = collection.orderBy(FieldPath.documentId()).limit(Math.min(pageSize, maxDocs - rows.length));
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    if (snapshot.empty) return rows;
    rows.push(...snapshot.docs.map((document) => ({ id: document.id, data: document.data(), ref: document.ref })));
    lastId = snapshot.docs.at(-1)?.id || null;
    if (snapshot.size < pageSize) return rows;
  }
  throw new Error(`${label} atingiu o limite de ${maxDocs} documentos. Revise --max-docs antes de continuar.`);
}

const [expenses, payments, transactions, profiles] = await Promise.all([
  readBounded(financialDbAdmin.collection("expenses"), "expenses"),
  readBounded(financialDbAdmin.collection("payments"), "payments"),
  readBounded(financialDbAdmin.collection("transactions"), "transactions"),
  readBounded(dbAdmin.collection("profiles"), "profiles"),
]);

const expenseById = new Map(expenses.map((row) => [row.id, row]));
const paymentsByExpense = new Map<string, Row[]>();
const transactionsByExpense = new Map<string, Row[]>();
for (const payment of payments) {
  const expenseId = String(payment.data.expenseId || "");
  if (!expenseId) continue;
  paymentsByExpense.set(expenseId, [...(paymentsByExpense.get(expenseId) || []), payment]);
}
for (const transaction of transactions) {
  if (transaction.data.reversed === true || transaction.data.auditStatus === "reversed") continue;
  const ids = new Set<string>([
    transaction.data.expenseId,
    transaction.data.linkedExpenseId,
    ...(Array.isArray(transaction.data.splitExpenseIds) ? transaction.data.splitExpenseIds : []),
  ].filter((value): value is string => typeof value === "string" && value.length > 0));
  for (const expenseId of ids) {
    transactionsByExpense.set(expenseId, [...(transactionsByExpense.get(expenseId) || []), transaction]);
  }
}

const changes: Change[] = [];
const ambiguities: Array<Record<string, unknown>> = [];
const now = Timestamp.now();

for (const expenseRow of expenses) {
  const expense = expenseRow.data;
  if (["draft", "cancelled", "reconciled"].includes(String(expense.status))) continue;
  if (expense.isPaymentAdjustment === true && expense.originExpenseId) {
    const parent = expenseById.get(String(expense.originExpenseId));
    if (parent) {
      const rootId = String(parent.data.reconciledProvisionId || parent.id);
      const obligationId = String(parent.data.obligationId || `obl_${safeKey(rootId)}`);
      if (expense.obligationId !== obligationId) {
        changes.push({ ref: expenseRow.ref, collection: "expenses", id: expenseRow.id, patch: { obligationId, updatedAt: now } });
      }
    }
    continue;
  }

  const forecastId = typeof expense.reconciledProvisionId === "string" ? expense.reconciledProvisionId : null;
  const forecast = forecastId ? expenseById.get(forecastId)?.data : null;
  const rootId = forecastId || expenseRow.id;
  const obligationId = String(expense.obligationId || forecast?.obligationId || `obl_${safeKey(rootId)}`);
  const bankRows = transactionsByExpense.get(expenseRow.id) || [];
  const manualRows = paymentsByExpense.get(expenseRow.id) || [];
  if (bankRows.length > 1) {
    ambiguities.push({ expenseId: expenseRow.id, type: "multiple_bank_transactions", transactionIds: bankRows.map((row) => row.id) });
  }

  const paymentAllocations: any[] = [];
  const paymentAdjustments: any[] = [];
  if (bankRows.length === 1) {
    const transaction = bankRows[0];
    const cashAmountCents = moneyToCents(Math.abs(Number(transaction.data.amount) || 0));
    const interestAmountCents = moneyToCents(transaction.data.interest);
    const fineAmountCents = moneyToCents(transaction.data.fine);
    const discountAmountCents = moneyToCents(transaction.data.discount);
    const abatementAmountCents = moneyToCents(transaction.data.abatement);
    const storedPrincipalAmountCents = Number(transaction.data.principalAmountCents);
    const principalAmountCents = Number.isInteger(storedPrincipalAmountCents) && storedPrincipalAmountCents >= 0
      ? storedPrincipalAmountCents
      : transaction.data.baseValue != null
        ? moneyToCents(transaction.data.baseValue)
        : Math.max(0, cashAmountCents - interestAmountCents - fineAmountCents);
    const linkId = `legacy_bank_${safeKey(`${expenseRow.id}:${transaction.id}`)}`;
    paymentAllocations.push({
      id: linkId,
      paymentId: null,
      bankTransactionId: transaction.id,
      expenseId: expenseRow.id,
      principalAmountCents,
      cashAmountCents,
      status: "MATCHED",
    });
    for (const [type, effect, amountCents] of [
      ["INTEREST", "CASH_CHARGE", interestAmountCents],
      ["FINE", "CASH_CHARGE", fineAmountCents],
      ["DISCOUNT", "SETTLEMENT_CREDIT", discountAmountCents],
      ["ABATEMENT", "SETTLEMENT_CREDIT", abatementAmountCents],
    ] as const) {
      if (amountCents <= 0) continue;
      paymentAdjustments.push({
        id: `legacy_adjustment_${safeKey(`${transaction.id}:${type}`)}`,
        linkId,
        paymentId: null,
        bankTransactionId: transaction.id,
        expenseId: expenseRow.id,
        type,
        effect,
        amountCents,
        amount: amountCents / 100,
        status: "CLASSIFIED",
        reason: "Classificação preservada pela migração.",
        responsibility: "UNDETERMINED",
      });
    }
  } else if (manualRows.length > 0) {
    for (const payment of manualRows) {
      const storedCashAmountCents = Number(payment.data.cashAmountCents);
      const cashAmountCents = Number.isInteger(storedCashAmountCents) && storedCashAmountCents >= 0
        ? storedCashAmountCents
        : moneyToCents(payment.data.totalPaid);
      const interestAmountCents = moneyToCents(payment.data.interest);
      const fineAmountCents = moneyToCents(payment.data.fine);
      const chargesAmountCents = interestAmountCents + fineAmountCents || moneyToCents(payment.data.charges);
      const storedPrincipalAmountCents = Number(payment.data.principalAmountCents);
      const principalAmountCents = Number.isInteger(storedPrincipalAmountCents) && storedPrincipalAmountCents >= 0
        ? storedPrincipalAmountCents
        : Math.max(0, cashAmountCents - chargesAmountCents);
      const linkId = `legacy_manual_${safeKey(payment.id)}`;
      paymentAllocations.push({
        id: linkId,
        paymentId: payment.id,
        bankTransactionId: null,
        expenseId: expenseRow.id,
        principalAmountCents,
        cashAmountCents,
        status: "REPORTED",
      });
      for (const [type, amountCents] of [
        ["INTEREST", interestAmountCents],
        ["FINE", fineAmountCents],
      ] as const) {
        if (amountCents <= 0) continue;
        paymentAdjustments.push({
          id: `legacy_adjustment_${safeKey(`${payment.id}:${type}`)}`,
          linkId,
          paymentId: payment.id,
          bankTransactionId: null,
          expenseId: expenseRow.id,
          type,
          effect: "CASH_CHARGE",
          amountCents,
          amount: amountCents / 100,
          status: "CLASSIFIED",
          reason: payment.data.notes || "Classificação preservada pela migração.",
          responsibility: "UNDETERMINED",
          accountPlanId: payment.data.chargesAccountPlanId || null,
          accountPlanName: payment.data.chargesAccountPlanName || null,
          chargeExpenseId: payment.data.manualChargeExpenseId || expense.manualChargesExpenseId || null,
        });
      }
    }
  } else if (expense.status === "paid") {
    ambiguities.push({ expenseId: expenseRow.id, type: "paid_without_payment_evidence" });
    const amountCents = moneyToCents(expense.totalValue);
    paymentAllocations.push({
      id: `legacy_status_${safeKey(expenseRow.id)}`,
      paymentId: null,
      bankTransactionId: null,
      expenseId: expenseRow.id,
      principalAmountCents: amountCents,
      cashAmountCents: amountCents,
      status: "REPORTED",
      evidenceWarning: "LEGACY_PAID_STATUS_WITHOUT_PAYMENT_DOCUMENT",
    });
  }

  const forecastAmountCents = forecast
    ? moneyToCents(forecast.totalValue)
    : expense.provisionedValue != null
      ? moneyToCents(expense.provisionedValue)
      : expense.provisionType === "forecast" ? moneyToCents(expense.totalValue) : null;
  const actualAmountCents = expense.provisionType === "forecast" ? null : moneyToCents(expense.totalValue);
  const settlementAmountCents = actualAmountCents == null
    ? null
    : moneyToCents(expense.netPayableValue) || actualAmountCents;
  const summary = calculateFinancialObligationSummary({
    forecastAmountCents,
    actualAmountCents,
    settlementAmountCents,
    paymentAllocations,
    adjustments: paymentAdjustments,
  });
  const obligationRef = financialDbAdmin.collection("financialObligations").doc(obligationId);
  changes.push({
    ref: obligationRef,
    collection: "financialObligations",
    id: obligationId,
    patch: {
      id: obligationId,
      seriesKey: expense.provisionSeriesKey || forecast?.provisionSeriesKey || null,
      competenceKey: competenceKey(expense) || (forecast ? competenceKey(forecast) : null),
      obligationType: expense.obligationType || "EXPENSE",
      sourceType: expense.cardStatementId ? "CARD_STATEMENT" : "EXPENSE",
      sourceId: expense.cardStatementId || expenseRow.id,
      supplierName: expense.supplier || null,
      status: summary.obligationStatus,
      reconciliationStatus: summary.reconciliationStatus,
      summary,
      migratedAt: now,
      updatedAt: now,
    },
  });
  changes.push({
    ref: expenseRow.ref,
    collection: "expenses",
    id: expenseRow.id,
    patch: {
      obligationId,
      settlementSummary: summary,
      paymentState: summary.paymentEvidenceStatus === "REPORTED" && summary.obligationStatus === "PAID"
        ? "reported_paid"
        : summary.reconciliationStatus === "DIVERGENT"
          ? "paid_divergent"
          : summary.obligationStatus === "PARTIALLY_PAID" ? "partially_paid" : summary.obligationStatus === "PAID" ? "paid" : "open",
      migratedAt: now,
      updatedAt: now,
    },
  });
  if (forecastId && forecast && forecast.obligationId !== obligationId) {
    changes.push({ ref: expenseById.get(forecastId)!.ref, collection: "expenses", id: forecastId, patch: { obligationId, migratedAt: now, updatedAt: now } });
  }
  for (const allocation of paymentAllocations) {
    changes.push({
      ref: financialDbAdmin.collection("obligationPaymentLinks").doc(allocation.id),
      collection: "obligationPaymentLinks",
      id: allocation.id,
      patch: { ...allocation, obligationId, origin: "MIGRATION", confidence: 1, migratedAt: now, updatedAt: now },
    });
    if (allocation.paymentId) {
      changes.push({
        ref: financialDbAdmin.collection("payments").doc(allocation.paymentId),
        collection: "payments",
        id: allocation.paymentId,
        patch: { obligationId, linkId: allocation.id, status: allocation.status, settlementSummary: summary, migratedAt: now, updatedAt: now },
      });
    }
  }
  for (const adjustment of paymentAdjustments) {
    changes.push({
      ref: financialDbAdmin.collection("paymentAdjustments").doc(adjustment.id),
      collection: "paymentAdjustments",
      id: adjustment.id,
      patch: { ...adjustment, obligationId, migratedAt: now, updatedAt: now },
    });
  }
}

for (const profile of profiles) {
  if (profile.data.permissions?.financial?.reconciliation) continue;
  const admin = profile.data.isDefaultAdmin === true;
  changes.push({
    ref: profile.ref,
    collection: "profiles",
    id: profile.id,
    patch: {
      permissions: {
        financial: {
          ...(profile.data.permissions?.financial || {}),
          reconciliation: {
            view: admin,
            confirm: admin,
            correct: admin,
            classifyAdjustments: admin,
            administer: admin,
          },
        },
      },
    },
  });
}

if (execute) {
  for (const [databaseKind, databaseChanges] of [
    ["financial", changes.filter((change) => change.collection !== "profiles")],
    ["profiles", changes.filter((change) => change.collection === "profiles")],
  ] as const) {
    for (let index = 0; index < databaseChanges.length; index += 350) {
      const batch = databaseKind === "profiles" ? dbAdmin.batch() : financialDbAdmin.batch();
      for (const change of databaseChanges.slice(index, index + 350)) {
        batch.set(change.ref, change.patch, { merge: true });
      }
      await batch.commit();
    }
  }
}

console.log(JSON.stringify({
  mode: execute ? "EXECUTED" : "DRY_RUN",
  limits: { maxDocs, pageSize },
  scanned: { expenses: expenses.length, payments: payments.length, transactions: transactions.length, profiles: profiles.length },
  changes: changes.reduce<Record<string, number>>((result, change) => ({ ...result, [change.collection]: (result[change.collection] || 0) + 1 }), {}),
  ambiguities,
}, null, 2));
