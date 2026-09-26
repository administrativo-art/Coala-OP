import "server-only";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { serializeFinancialValue } from "../lib/server-access";
import { calculateFinancialObligationSummary } from "../obligations/calculations";
import { buildBudgetResidualProjections } from "./composition";
import { resolveBudgetExpenseCenters } from "./references.server";
import { validateBudgetAccounts } from "./service.server";
import { assertForecastConversionDestinations, forecastConversionCandidate, forecastConversionSchema, type ForecastConversionInput } from "./forecast-conversion";
import { BudgetDomainError } from "./errors";
import type { BudgetExpense } from "../lib/budget-consumption";
import type { FinancialBudget } from "./types";

export function assertForecastConversionActor(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin) throw new AppError({ code: "BUDGET_CONVERSION_ADMIN_REQUIRED", kind: "AUTHORIZATION" });
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(serializeFinancialValue(value))).digest("hex");
const collections = (name: string) => financialDbAdmin.collection(name);

export async function listForecastConversionCandidates(month: string, actor: ServerUserContext) {
  assertForecastConversionActor(actor);
  const snapshot = await collections("expenses").where("competenceMonth", "==", month).where("provisionType", "==", "forecast")
    .where("status", "==", "provisioned").where("provisionSeriesKey", ">=", "recurring:vale-transporte:")
    .where("provisionSeriesKey", "<", "recurring:vale-transporte;").limit(101).get();
  if (snapshot.size > 100) throw new BudgetDomainError("Há mais de 100 previsões de VT; refine o lote antes de converter.");
  const rows = await resolveBudgetExpenseCenters(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as BudgetExpense)));
  return rows.map((expense) => {
    try { return { ...forecastConversionCandidate(expense, month), blocked: null }; }
    catch (error) {
      if (!(error instanceof BudgetDomainError)) throw error;
      return { id: expense.id, description: expense.description ?? "Previsão de VT", blocked: error.message };
    }
  });
}

async function readConversion(tx: FirebaseFirestore.Transaction, input: ForecastConversionInput) {
  const sourceIds = input.mappings.map((mapping) => mapping.expenseId);
  const budgetIds = [...new Set(input.mappings.flatMap((mapping) => mapping.destinations.map((target) => target.budgetId)))];
  const [sourceDocs, budgetDocs, monthly] = await Promise.all([
    tx.getAll(...sourceIds.map((id) => collections("expenses").doc(id))),
    tx.getAll(...budgetIds.map((id) => collections("financialBudgets").doc(id))),
    tx.get(collections("expenses").where("competenceMonth", "==", input.month).limit(2001)),
  ]);
  if (sourceDocs.some((doc) => !doc.exists) || budgetDocs.some((doc) => !doc.exists) || monthly.size > 2000) throw new BudgetDomainError("Origem/destino ausente ou limite mensal excedido.");
  const budgets = budgetDocs.map((doc) => ({ ...doc.data(), id: doc.id } as FinancialBudget));
  const accounts = [...new Set(budgets.flatMap((budget) => budget.accountPlanIds))];
  if (accounts.length > 30) throw new BudgetDomainError("O lote suporta até 30 contas.");
  await validateBudgetAccounts(accounts, tx);
  // Use the same normalization in listing, preview and confirmation, under the transaction.
  const normalizedSources = await resolveBudgetExpenseCenters(sourceDocs.map((doc) => ({ ...doc.data(), id: doc.id } as BudgetExpense)), tx);
  const obligationDocs: FirebaseFirestore.DocumentSnapshot[] = [];
  const beforeAfter = [];
  for (const mapping of input.mappings) {
    const doc = sourceDocs.find((source) => source.id === mapping.expenseId)!;
    const data = { ...doc.data(), id: doc.id } as BudgetExpense & Record<string, any>;
    const source = forecastConversionCandidate(normalizedSources.find((item) => item.id === doc.id)!, input.month);
    const destinations = mapping.destinations.map((target) => {
      const budget = budgets.find((item) => item.id === target.budgetId)!;
      const line = budget.composition?.find((item) => item.id === target.lineId);
      if (!budget.active || !budget.resultCenterId || budget.competenceMonth !== input.month || !line
        || line.employeeId !== source.employeeId || line.accountPlanId !== source.accountPlanId || line.expectedPurchaseDate !== source.expectedPurchaseDate) {
        throw new BudgetDomainError("Destino deve preservar pessoa, conta, competência e data de compra; revise a composição.");
      }
      return { ...target, resultCenterId: budget.resultCenterId, resultCenterName: budget.resultCenterName ?? "Centro", amountCents: line.amountCents };
    });
    assertForecastConversionDestinations(source, destinations);
    if (monthly.docs.some((other) => other.id !== doc.id && other.get("provisionSeriesKey") === data.provisionSeriesKey
      && !["draft", "cancelled"].includes(String(other.get("status"))))) throw new BudgetDomainError("Há outro registro da mesma série/competência; revise a duplicidade ou reconciliação.");
    const presence = [
      collections("payments").where("expenseId", "==", doc.id),
      collections("bankPaymentRequests").where("expenseId", "==", doc.id),
      collections("bankPaymentRequests").where("sourceId", "==", doc.id),
      collections("transactions").where("expenseId", "==", doc.id),
      collections("transactions").where("linkedExpenseId", "==", doc.id),
      collections("transactions").where("splitExpenseIds", "array-contains", doc.id),
      collections("obligationPaymentLinks").where("expenseId", "==", doc.id),
      collections("expenses").where("reconciledProvisionId", "==", doc.id),
    ];
    if ((await Promise.all(presence.map((query) => tx.get(query.limit(1))))).some((snapshot) => !snapshot.empty)) throw new BudgetDomainError("Origem vinculada a pagamento, solicitação, extrato ou documento real; conversão bloqueada.");
    const found = await tx.get(collections("financialObligations").where("sourceId", "==", doc.id).limit(2));
    if (found.size > 1) throw new BudgetDomainError("Mais de uma obrigação referencia a previsão.");
    const obligationId = data.obligationId || found.docs[0]?.id;
    if (obligationId) {
      const obligation = await tx.get(collections("financialObligations").doc(String(obligationId)));
      if (!obligation.exists || found.docs.some((item) => item.id !== obligation.id)) throw new BudgetDomainError("Vínculo de obrigação inconsistente.");
      const summary = obligation.get("summary") ?? {};
      if (obligation.get("status") !== "OPEN" || obligation.get("sourceId") !== doc.id
        || obligation.get("reconciliationStatus") === "MATCHED" || summary.reconciliationStatus === "MATCHED"
        || summary.actualAmountCents != null || summary.paymentEvidenceStatus && summary.paymentEvidenceStatus !== "NONE"
        || ["cashPaidAmountCents", "principalSettledAmountCents", "confirmedCashAmountCents", "reportedCashAmountCents", "settlementCreditsAmountCents", "unclassifiedDifferenceAmountCents"].some((key) => Number(summary[key] ?? 0) !== 0)) {
        throw new BudgetDomainError("Obrigação com atividade ou documento real; conversão bloqueada.");
      }
      const [links, adjustments, shared] = await Promise.all([
        tx.get(collections("obligationPaymentLinks").where("obligationId", "==", obligation.id).limit(1)),
        tx.get(collections("paymentAdjustments").where("obligationId", "==", obligation.id).limit(1)),
        tx.get(collections("expenses").where("obligationId", "==", obligation.id).limit(2)),
      ]);
      if (!links.empty || !adjustments.empty || shared.docs.some((item) => item.id !== doc.id)) throw new BudgetDomainError("Obrigação compartilhada, com vínculo ou ajuste: não será convertida.");
      obligationDocs.push(obligation);
    }
    beforeAfter.push({ ...source, destinations, obligationId: obligationId ?? null });
  }
  const expenses = await resolveBudgetExpenseCenters(monthly.docs.map((doc) => ({ ...doc.data(), id: doc.id } as BudgetExpense)), tx);
  const before = buildBudgetResidualProjections(budgets, expenses);
  const after = buildBudgetResidualProjections(budgets, expenses.map((expense) => sourceIds.includes(expense.id) ? { ...expense, status: "cancelled" } : expense));
  const preview = {
    rows: beforeAfter,
    forecastAmountCents: beforeAfter.reduce((sum, row) => sum + row.amountCents, 0),
    residualBeforeCents: before.projections.reduce((sum, row) => sum + row.amountCents, 0),
    residualAfterCents: after.projections.reduce((sum, row) => sum + row.amountCents, 0),
    dreEffect: "As previsões convertidas saem das despesas da DRE e permanecem na comparação de orçamento; o boleto real não muda.",
    conflictsAfter: after.conflicts.length,
  };
  const versions = [...sourceDocs, ...budgetDocs, ...obligationDocs].map((doc) => [doc.ref.path, doc.updateTime?.toMillis()]);
  return { sourceDocs, budgetDocs, obligationDocs, preview, fingerprint: hash([input, versions, preview, monthly.docs.map((doc) => [doc.id, doc.updateTime?.toMillis()])]) };
}

export async function convertForecastsToBudgets(input: ForecastConversionInput, actor: ServerUserContext, confirmation?: { fingerprint: string; confirmed: true }) {
  assertForecastConversionActor(actor);
  input = forecastConversionSchema.parse(input);
  const operationId = `vt_${hash(input)}`;
  return financialDbAdmin.runTransaction(async (tx) => {
    const operationRef = collections("financialBudgetConversions").doc(operationId);
    const prior = await tx.get(operationRef);
    if (prior.exists) return { operationId, converted: true, alreadyConverted: true, preview: prior.get("preview"), fingerprint: prior.get("fingerprint") };
    const plan = await readConversion(tx, input);
    if (!confirmation) return { operationId, converted: false, alreadyConverted: false, preview: plan.preview, fingerprint: plan.fingerprint };
    if (!confirmation.confirmed || confirmation.fingerprint !== plan.fingerprint) throw new BudgetDomainError("A prévia mudou. Confira novamente antes de converter; nada foi alterado.");
    const now = Timestamp.now();
    const marker = { operationId, reason: "MIGRATED_TO_BUDGET", migratedAt: now, actorUid: actor.decoded.uid };
    for (const doc of plan.sourceDocs) {
      const summary = calculateFinancialObligationSummary({ forecastAmountCents: Math.round(Number(doc.get("totalValue")) * 100), cancelled: true });
      tx.update(doc.ref, { status: "cancelled", paymentState: "cancelled", settlementSummary: summary,
        cancellationReason: "MIGRATED_TO_BUDGET", budgetMigration: { ...marker, destinations: input.mappings.find((mapping) => mapping.expenseId === doc.id)!.destinations },
        installments: (doc.get("installments") ?? []).map((part: Record<string, any>) => ({ ...part, status: "cancelled" })), updatedAt: now });
      tx.create(doc.ref.collection("events").doc(operationId), { ...marker, type: "FORECAST_TRANSFERRED_TO_BUDGET", reason: input.reason });
    }
    for (const doc of plan.obligationDocs) {
      tx.update(doc.ref, { status: "CANCELLED", cancellationReason: "MIGRATED_TO_BUDGET", budgetMigration: marker, updatedAt: now,
        summary: calculateFinancialObligationSummary({ forecastAmountCents: doc.get("summary.forecastAmountCents") ?? null, cancelled: true }) });
    }
    for (const doc of plan.budgetDocs) {
      tx.update(doc.ref, { updatedAt: now });
      tx.create(collections("financialBudgetRevisions").doc(), { budgetId: doc.id, action: "forecast_conversion", ...marker, changes: input.mappings, reason: input.reason, createdAt: now });
    }
    tx.create(operationRef, { ...marker, input, preview: plan.preview, fingerprint: plan.fingerprint, createdAt: now });
    return { operationId, converted: true, alreadyConverted: false, preview: plan.preview, fingerprint: plan.fingerprint };
  });
}
