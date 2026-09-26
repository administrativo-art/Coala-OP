import { createHash } from "node:crypto";
import { financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import { calculateBudgetConsumption, isActualBudgetExpense, type BudgetExpense } from "../lib/budget-consumption";
import { personAllocationsAreValid, expensePersonAllocations } from "../lib/expense-person-allocations";
import type { BudgetCoverage, BudgetPersonLine, BudgetPersonSummary, FinancialBudget, FinancialBudgetRule } from "./types";
import { BudgetDomainError } from "./errors";

export function shiftBudgetMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function budgetPurchaseDate(month: string, day: number, offset: -1 | 0) {
  const purchaseMonth = shiftBudgetMonth(month, offset);
  const [year, number] = purchaseMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${purchaseMonth}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function materializeBudgetComposition(rule: Pick<FinancialBudgetRule, "composition">, month: string): BudgetPersonLine[] | undefined {
  return rule.composition?.map(({ purchaseDay, purchaseMonthOffset, ...line }) => ({
    ...line, expectedPurchaseDate: budgetPurchaseDate(month, purchaseDay, purchaseMonthOffset), estimateSource: "fixed",
  }));
}

/** Canonical financial support, deliberately excludes payment state and presentation names. */
export function budgetDocumentFingerprint(expense: BudgetExpense) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value ?? null;
  };
  const sorted = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
  return createHash("sha256").update(JSON.stringify([
    expense.id, financialExpenseCompetenceMonth(expense), isActualBudgetExpense(expense),
    Math.round((expense.totalValue ?? 0) * 100), expense.accountId ?? expense.accountPlan ?? null,
    expense.hasAccountAllocations === true,
    sorted((expense.accountAllocations ?? []).map((p) => [p.accountPlanId, Math.round(p.amount * 100)])),
    expense.resultCenter ?? null, expense.isApportioned === true,
    sorted((expense.apportionments ?? []).map((p) => [p.resultCenter ?? null, p.percentage ?? null])),
    expense.hasPersonAllocations === true,
    sorted((expense.personAllocations ?? []).map((p) => [p.id ?? null, p.employeeId, p.accountPlanId, p.resultCenter ?? null, p.analysisType, Math.round(p.amount * 100)])),
    canonical([expense.documentIdentity, expense.fiscalIdentity, expense.boletoAttachment, expense.attachments,
      expense.documentUrl, expense.financialInboxMessageId, expense.sourceDocumentSha256, expense.sourceReference, expense.purchaseOrderId]),
  ])).digest("hex");
}

export function budgetLineDocuments(budget: FinancialBudget, line: BudgetPersonLine, expenses: BudgetExpense[]) {
  return expenses.filter((expense) => isActualBudgetExpense(expense)
    && financialExpenseCompetenceMonth(expense) === budget.competenceMonth
    && personAllocationsAreValid(expense)
    && calculateBudgetConsumption(budget, [expense]).consumedAmountCents > 0)
    .flatMap((expense) => {
      const amountCents = expensePersonAllocations(expense)
        .filter((p) => p.employeeId === line.employeeId && p.accountPlanId === line.accountPlanId && p.resultCenter === budget.resultCenterId)
        .reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
      return amountCents > 0 ? [{ expenseId: expense.id, amountCents, fingerprint: budgetDocumentFingerprint(expense) }] : [];
    }).sort((a, b) => a.expenseId.localeCompare(b.expenseId));
}

export function makeBudgetCoverage(budget: FinancialBudget, expenses: BudgetExpense[], input: {
  lineId: string; state: BudgetCoverage["state"]; documentIds: string[]; documentFingerprints?: Record<string, string>; residualAmountCents?: number; reason: string;
}, uid: string, now: string): BudgetCoverage {
  const line = budget.composition?.find((p) => p.id === input.lineId);
  if (!line || !budget.active) throw new BudgetDomainError("Selecione uma pessoa de um orçamento ativo.");
  const documents = budgetLineDocuments(budget, line, expenses);
  if ((input.state === "not_required" ? documents.length > 0 : documents.length === 0) || documents.length !== input.documentIds.length
    || documents.some((doc) => !input.documentIds.includes(doc.expenseId))) {
    throw new BudgetDomainError("Confirme todos os documentos reais válidos que suportam esta pessoa, conta e centro.");
  }
  if (input.documentFingerprints && documents.some((doc) => input.documentFingerprints![doc.expenseId] !== doc.fingerprint)) {
    throw new BudgetDomainError("Os documentos mudaram após a prévia. Atualize e confira novamente.");
  }
  if (budget.expectationStops?.some((stop) => stop.lineId === line.id)) throw new BudgetDomainError("Expectativa encerrada por desligamento; preserve o histórico.");
  return {
    lineId: line.id, state: input.state,
    documents: documents.map(({ expenseId, fingerprint }) => ({ expenseId, fingerprint })),
    residualAmountCents: input.state !== "partial" ? 0 : input.residualAmountCents ?? null,
    reason: input.reason, confirmedBy: uid, confirmedAt: now,
  };
}

export function summarizeBudgetPeople(budget: FinancialBudget, expenses: BudgetExpense[]) {
  const issues: string[] = [];
  const eligible = expenses.filter((expense) => isActualBudgetExpense(expense)
    && financialExpenseCompetenceMonth(expense) === budget.competenceMonth);
  const people: BudgetPersonSummary[] = (budget.composition ?? []).map((line) => {
    const documents = budgetLineDocuments(budget, line, eligible);
    const committedAmountCents = documents.reduce((sum, d) => sum + d.amountCents, 0);
    const confirmation = budget.coverage?.find((coverage) => coverage.lineId === line.id);
    const valid = Boolean(confirmation && (confirmation.state === "not_required" ? documents.length === 0 : documents.length > 0) && confirmation.documents.length === documents.length
      && documents.every((doc) => confirmation.documents.some((old) => old.expenseId === doc.expenseId && old.fingerprint === doc.fingerprint)));
    if (confirmation && !valid) issues.push(`Cobertura requer nova confirmação na linha ${line.id}.`);
    const balanceAmountCents = line.amountCents - committedAmountCents;
    const stopped = budget.expectationStops?.some((stop) => stop.lineId === line.id);
    return { ...line, committedAmountCents, balanceAmountCents,
      residualAmountCents: stopped || (valid && confirmation?.state !== "partial") ? 0
        : valid && confirmation?.residualAmountCents != null ? confirmation.residualAmountCents : Math.max(0, balanceAmountCents),
      coverageState: stopped ? "not_required" : confirmation && !valid ? "invalidated" : valid ? confirmation!.state : committedAmountCents > 0 ? "partial" : "open",
      documentIds: documents.map((doc) => doc.expenseId),
      documentFingerprints: Object.fromEntries(documents.map((doc) => [doc.expenseId, doc.fingerprint])),
    };
  });
  let identified = 0;
  let outsideCompositionAmountCents = 0;
  for (const expense of eligible) {
    if (!personAllocationsAreValid(expense) || calculateBudgetConsumption(budget, [expense]).consumedAmountCents <= 0) continue;
    for (const part of expensePersonAllocations(expense)) {
      if (part.resultCenter !== budget.resultCenterId || !budget.accountPlanIds.includes(part.accountPlanId)) continue;
      const amount = Math.round(part.amount * 100);
      identified += amount;
      if (!people.some((line) => line.employeeId === part.employeeId && line.accountPlanId === part.accountPlanId)) outsideCompositionAmountCents += amount;
    }
  }
  const unidentifiedAmountCents = Math.max(0, calculateBudgetConsumption(budget, eligible).consumedAmountCents - identified);
  if (outsideCompositionAmountCents) issues.push("Há parcelas reais fora da composição planejada.");
  if (unidentifiedAmountCents) issues.push("Há parcelas reais com pessoa a identificar.");
  return { people, residualAmountCents: people.reduce((sum, line) => sum + line.residualAmountCents, 0),
    unidentifiedAmountCents, outsideCompositionAmountCents, issues };
}

export function budgetExpectationKey(input: { employeeId: string; accountPlanId: string; resultCenterId: string; competenceMonth: string }) {
  return JSON.stringify([input.employeeId, input.accountPlanId, input.resultCenterId, input.competenceMonth]);
}

export function budgetForecastEmployeeId(expense: BudgetExpense) {
  return expense.employeeId?.trim() || expense.employeeUserId?.trim()
    || expense.provisionSeriesKey?.match(/^recurring:vale-transporte:([^:]+)$/)?.[1] || null;
}

/** Pure integration boundary: caller resolves centers to IDs, loads expenses once and authorizes access.
 * replacementKeys includes CLOSED zero-residual lines. Suppress only matching legacy forecast parcels,
 * never an entire mixed-person document. Projections are expectations, never debt/payment instructions.
 */
export function buildBudgetResidualProjections(budgets: FinancialBudget[], expenses: BudgetExpense[], range?: { from: string; to: string }) {
  const replacementKeys: string[] = [];
  const seenKeys = new Set<string>();
  const conflicts: Array<{ budgetId: string; lineId: string; forecastIds: string[]; replacementKey: string }> = [];
  const projections: Array<{ id: string; budgetId: string; lineId: string; employeeId: string; accountPlanId: string;
    resultCenterId: string; competenceMonth: string; expectedPurchaseDate: string; amountCents: number; replacementKey: string;
    source: "budget_residual"; requiresReview: boolean }> = [];
  const issues: string[] = [];
  for (const budget of budgets) {
    if (!budget.active || !budget.resultCenterId || !budget.composition?.length) continue;
    const summary = summarizeBudgetPeople(budget, expenses);
    issues.push(...summary.issues);
    for (const line of summary.people) {
      const replacementKey = budgetExpectationKey({ ...line, resultCenterId: budget.resultCenterId, competenceMonth: budget.competenceMonth });
      if (seenKeys.has(replacementKey)) throw new BudgetDomainError("Expectativas sobrepostas no conjunto de orçamentos.");
      seenKeys.add(replacementKey);
      const forecastIds = expenses.filter((expense) => expense.provisionType === "forecast"
        && !["draft", "cancelled", "reconciled"].includes(String(expense.status))
        && financialExpenseCompetenceMonth(expense) === budget.competenceMonth
        && (expense.hasPersonAllocations
          ? expense.personAllocations?.some((part) => part.employeeId === line.employeeId && part.accountPlanId === line.accountPlanId)
          : budgetForecastEmployeeId(expense) === line.employeeId && (expense.accountAllocations?.length
            ? expense.accountAllocations.some((part) => part.accountPlanId === line.accountPlanId)
            : (expense.accountId ?? expense.accountPlan) === line.accountPlanId)))
        .map((expense) => expense.id);
      if (forecastIds.length) {
        conflicts.push({ budgetId: budget.id, lineId: line.id, forecastIds, replacementKey });
        issues.push(`Previsão legada coexistente na linha ${line.id}; projeção residual suspensa.`);
        continue;
      }
      replacementKeys.push(replacementKey);
      if (!line.residualAmountCents || (range && (line.expectedPurchaseDate < range.from || line.expectedPurchaseDate > range.to))) continue;
      projections.push({ id: `${budget.id}:${line.id}`, budgetId: budget.id, lineId: line.id,
        employeeId: line.employeeId, accountPlanId: line.accountPlanId, resultCenterId: budget.resultCenterId,
        competenceMonth: budget.competenceMonth, expectedPurchaseDate: line.expectedPurchaseDate,
        amountCents: line.residualAmountCents, replacementKey, source: "budget_residual",
        requiresReview: line.coverageState === "open" || line.coverageState === "invalidated" || summary.unidentifiedAmountCents > 0,
      });
    }
  }
  return { projections, replacementKeys, conflicts, issues };
}
