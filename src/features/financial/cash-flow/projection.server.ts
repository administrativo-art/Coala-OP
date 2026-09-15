import "server-only";

import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import { FINANCIAL_DRE_START_MONTH_KEY } from "@/features/financial/lib/constants";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { FinancialObligationStatus } from "@/features/financial/obligations/types";
import type { StoneReceivable } from "@/features/financial/stone-receivables/types";
import {
  addCashFlowCivilDays,
  buildCashFlowProjection,
  type CashFlowObligationInput,
  type CashFlowOpeningBalance,
  type CashFlowPaymentRequestInput,
  type CashFlowProjectionScope,
  type CashFlowTransactionInput,
} from "./projection";

const MAX_ACCOUNTS = 50;
const MAX_RECEIVABLES = 5_000;
const MAX_EXPENSES = 5_000;
const MAX_UNPROGRAMMED_EXPENSES = 500;
const MAX_PAYMENT_REQUESTS = 5_000;
const MAX_TRANSACTIONS = 5_000;
const OPEN_EXPENSE_STATUSES = ["pending", "overdue", "partially_paid", "reported_paid", "paid_divergent"];

export class CashFlowProjectionLimitError extends Error {
  constructor(readonly source: "accounts" | "receivables" | "expenses" | "unprogrammed" | "payment_requests" | "transactions") {
    super("O volume ultrapassa o limite operacional da projeção de caixa.");
    this.name = "CashFlowProjectionLimitError";
  }
}

function startOfBelemDay(value: string) {
  return Timestamp.fromDate(new Date(`${value}T03:00:00.000Z`));
}

function endOfBelemDay(value: string) {
  return Timestamp.fromDate(new Date(`${addCashFlowCivilDays(value, 1)}T02:59:59.999Z`));
}

function civilDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof (value as { toDate?: unknown })?.toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function isoInstant(value: unknown): string | null {
  if (typeof value === "string") return value;
  const date = typeof (value as { toDate?: unknown })?.toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date ? value : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function cents(data: Record<string, unknown>, centsField: string, reaisField: string) {
  const direct = Number(data[centsField]);
  if (Number.isSafeInteger(direct)) return Math.abs(direct);
  const reais = Number(data[reaisField]);
  return Number.isFinite(reais) ? Math.round(Math.abs(reais) * 100) : 0;
}

function stringArray(data: Record<string, unknown>, ...fields: string[]) {
  const values = fields.flatMap((field) => {
    const value = data[field];
    if (Array.isArray(value)) return value.map(String);
    return typeof value === "string" && value ? [value] : [];
  });
  return [...new Set(values)];
}

function workspaceMatches(data: Record<string, unknown>, workspaceId: string) {
  return data.workspaceId === undefined || data.workspaceId === workspaceId;
}

function ensureLimit(size: number, maximum: number, source: CashFlowProjectionLimitError["source"]) {
  if (size > maximum) throw new CashFlowProjectionLimitError(source);
}

async function getAllInChunks(references: FirebaseFirestore.DocumentReference[]) {
  const result: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let index = 0; index < references.length; index += 200) {
    result.push(...await financialDbAdmin.getAll(...references.slice(index, index + 200)));
  }
  return result;
}

function mapObligations(
  expenseDocuments: FirebaseFirestore.QueryDocumentSnapshot[],
  obligationById: Map<string, Record<string, unknown>>,
  workspaceId: string,
) {
  const expenseByObligation = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  for (const document of expenseDocuments) {
    const data = document.data();
    if (!workspaceMatches(data, workspaceId)) continue;
    const obligationId = String(data.obligationId || `obl_${document.id}`);
    const current = expenseByObligation.get(obligationId) ?? [];
    current.push({ id: document.id, data });
    expenseByObligation.set(obligationId, current);
  }
  return [...expenseByObligation.entries()].map(([obligationId, entries]): CashFlowObligationInput => {
    const expense = [...entries].sort((left, right) => (
      Number(left.data.provisionType === "forecast") - Number(right.data.provisionType === "forecast")
      || left.id.localeCompare(right.id)
    ))[0];
    const obligation = obligationById.get(obligationId) ?? {};
    const summary = obligation.summary && typeof obligation.summary === "object"
      ? obligation.summary as Record<string, unknown>
      : {};
    const status = String(obligation.status ?? (
      expense.data.status === "cancelled" ? "CANCELLED"
        : expense.data.status === "paid" ? "PAID"
          : expense.data.status === "partially_paid" ? "PARTIALLY_PAID" : "OPEN"
    )) as FinancialObligationStatus;
    return {
      id: obligationId,
      expenseId: expense.id,
      accountId: typeof expense.data.bankAccountId === "string"
        ? expense.data.bankAccountId
        : typeof expense.data.paymentAccountId === "string" ? expense.data.paymentAccountId : null,
      kioskIds: stringArray(expense.data, "kioskId", "unitId", "unitIds", "resultCenterId", "resultCenterIds"),
      description: String(expense.data.description || obligation.supplierName || "Obrigação financeira"),
      dueDate: civilDate(expense.data.paymentDate ?? expense.data.dueDate ?? expense.data.competenceDate),
      forecastAmountCents: cents(expense.data, "totalAmountCents", "totalValue"),
      balanceAmountCents: typeof summary.balanceAmountCents === "number" && Number.isSafeInteger(summary.balanceAmountCents)
        ? Math.max(0, summary.balanceAmountCents)
        : null,
      status,
      sourceRevision: typeof obligation.sourceRevision === "string" ? obligation.sourceRevision : null,
      sourceHash: typeof obligation.sourceHash === "string" ? obligation.sourceHash : null,
      sourceUpdatedAt: isoInstant(obligation.updatedAt ?? expense.data.updatedAt),
    };
  });
}

export async function getCashFlowProjection(input: {
  workspaceId: string;
  asOf: string;
  days: number;
  scope: CashFlowProjectionScope;
  canAccessKiosk: (kioskId: string) => boolean;
}) {
  const endDate = addCashFlowCivilDays(input.asOf, input.days - 1);
  const expenseLookback = `${FINANCIAL_DRE_START_MONTH_KEY}-01`;
  const [accountsSnapshot, receivablesSnapshot, expensesSnapshot, unprogrammedSnapshot, requestsSnapshot, transactionsSnapshot] = await Promise.all([
    financialDbAdmin.collection("bankAccounts").orderBy(FieldPath.documentId()).limit(MAX_ACCOUNTS + 1).get(),
    financialDbAdmin.collection("stoneReceivables")
      .where("workspaceId", "==", input.workspaceId)
      .where("currentExpectedDate", ">=", expenseLookback)
      .where("currentExpectedDate", "<=", endDate)
      .orderBy("currentExpectedDate")
      .orderBy(FieldPath.documentId())
      .limit(MAX_RECEIVABLES + 1)
      .get(),
    financialDbAdmin.collection("expenses")
      .where("status", "in", OPEN_EXPENSE_STATUSES)
      .where("dueDate", ">=", startOfBelemDay(expenseLookback))
      .where("dueDate", "<=", endOfBelemDay(endDate))
      .orderBy("dueDate")
      .orderBy(FieldPath.documentId())
      .limit(MAX_EXPENSES + 1)
      .get(),
    financialDbAdmin.collection("expenses")
      .where("status", "in", OPEN_EXPENSE_STATUSES)
      .where("dueDate", "==", null)
      .limit(MAX_UNPROGRAMMED_EXPENSES + 1)
      .get(),
    financialDbAdmin.collection("bankPaymentRequests")
      .where("scheduledFor", ">=", input.asOf)
      .where("scheduledFor", "<=", endDate)
      .orderBy("scheduledFor")
      .orderBy(FieldPath.documentId())
      .limit(MAX_PAYMENT_REQUESTS + 1)
      .get(),
    financialDbAdmin.collection("transactions")
      .where("date", ">=", startOfBelemDay(input.asOf))
      .where("date", "<=", endOfBelemDay(endDate))
      .orderBy("date")
      .orderBy(FieldPath.documentId())
      .limit(MAX_TRANSACTIONS + 1)
      .get(),
  ]);
  ensureLimit(accountsSnapshot.size, MAX_ACCOUNTS, "accounts");
  ensureLimit(receivablesSnapshot.size, MAX_RECEIVABLES, "receivables");
  ensureLimit(expensesSnapshot.size, MAX_EXPENSES, "expenses");
  ensureLimit(unprogrammedSnapshot.size, MAX_UNPROGRAMMED_EXPENSES, "unprogrammed");
  ensureLimit(requestsSnapshot.size, MAX_PAYMENT_REQUESTS, "payment_requests");
  ensureLimit(transactionsSnapshot.size, MAX_TRANSACTIONS, "transactions");

  const expenseDocuments = [...expensesSnapshot.docs, ...unprogrammedSnapshot.docs.filter((candidate) => (
    !expensesSnapshot.docs.some((document) => document.id === candidate.id)
  ))];
  const obligationIds = [...new Set(expenseDocuments.map((document) => String(document.data().obligationId || `obl_${document.id}`)))];
  const obligationSnapshots = await getAllInChunks(obligationIds.map((id) => financialDbAdmin.collection("financialObligations").doc(id)));
  const obligationById = new Map(obligationSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));

  const openingBalances: CashFlowOpeningBalance[] = accountsSnapshot.docs.flatMap((document) => {
    const data = document.data();
    if (data.active === false || !workspaceMatches(data, input.workspaceId)) return [];
    const confirmedAt = isoInstant(data.balanceConfirmedAt ?? data.lastReconciledAt ?? data.confirmedAt);
    const confirmedBalance = Number(data.confirmedBalanceCents);
    return [{
      accountId: document.id,
      accountName: String(data.name || document.id),
      balanceCents: Number.isSafeInteger(confirmedBalance) && confirmedAt ? confirmedBalance : null,
      confirmedAt,
      source: typeof data.balanceSource === "string" ? data.balanceSource : null,
    }];
  });
  const receivables = receivablesSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() } as StoneReceivable))
    .filter((entry) => entry.kioskId ? input.canAccessKiosk(entry.kioskId) : false);
  const obligations = mapObligations(expenseDocuments, obligationById, input.workspaceId)
    .filter((entry) => entry.kioskIds.length === 0 || entry.kioskIds.every(input.canAccessKiosk));
  const paymentRequests: CashFlowPaymentRequestInput[] = requestsSnapshot.docs.flatMap((document) => {
    const data = document.data();
    if (!workspaceMatches(data, input.workspaceId)) return [];
    return [{
      id: document.id,
      obligationId: typeof data.obligationId === "string" ? data.obligationId : null,
      expenseId: typeof data.expenseId === "string" ? data.expenseId : null,
      accountId: typeof data.accountId === "string" ? data.accountId : null,
      amountCents: cents(data, "amountCents", "amount"),
      scheduledFor: civilDate(data.scheduledFor),
      status: String(data.status || "draft"),
    }];
  });
  const transactions: CashFlowTransactionInput[] = transactionsSnapshot.docs.flatMap((document) => {
    const data = document.data();
    if (!workspaceMatches(data, input.workspaceId)) return [];
    const date = civilDate(data.date);
    if (!date) return [];
    const type = String(data.type || "adjustment");
    return [{
      id: document.id,
      obligationId: typeof data.obligationId === "string" ? data.obligationId : null,
      expenseId: typeof data.expenseId === "string" ? data.expenseId : typeof data.linkedExpenseId === "string" ? data.linkedExpenseId : null,
      accountId: typeof data.accountId === "string" ? data.accountId : null,
      kioskIds: stringArray(data, "kioskId", "unitId", "unitIds", "resultCenterId", "resultCenterIds"),
      description: String(data.description || "Movimentação financeira"),
      date,
      direction: data.direction === "out" || type === "expense_payment" || type === "transfer_out" ? "out" : "in",
      amountCents: cents(data, "amountCents", "amount"),
      type,
      transferGroupId: typeof data.transferGroupId === "string" ? data.transferGroupId : null,
      reversed: data.reversed === true || data.auditStatus === "reversed",
      sourceRevision: typeof data.sourceRevision === "string" ? data.sourceRevision : null,
      sourceHash: typeof data.sourceHash === "string" ? data.sourceHash : null,
      sourceUpdatedAt: isoInstant(data.updatedAt ?? data.createdAt),
    }];
  });

  return serializeFinancialValue({
    ...buildCashFlowProjection({
      asOf: input.asOf,
      days: input.days,
      scope: input.scope,
      openingBalances,
      receivables,
      obligations,
      paymentRequests,
      transactions,
      generatedAt: new Date().toISOString(),
    }),
    cutoffs: {
      receivables: receivablesSnapshot.size,
      obligations: obligations.length,
      paymentRequests: requestsSnapshot.size,
      transactions: transactionsSnapshot.size,
    },
  });
}
