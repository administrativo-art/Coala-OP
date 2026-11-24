import type { PermissionSet } from "@/types";
import type { FinancialBudgetSummary } from "./types";
import { FINANCIAL_ROUTES } from "../lib/constants";

/** Mirrors the existing budget read permission; viewing expenses alone does not grant access. */
export function canViewBudgetComparison(permissions: Pick<PermissionSet, "financial">, isDefaultAdmin = false) {
  return isDefaultAdmin || Boolean(permissions.financial?.view
    && (permissions.financial.settings?.view || permissions.financial.cashFlow?.view));
}

export function budgetComparisonTotals(budgets: FinancialBudgetSummary[]) {
  const active = budgets.filter((budget) => budget.active);
  return {
    planned: active.reduce((sum, budget) => sum + budget.budgetedAmountCents, 0),
    committed: active.reduce((sum, budget) => sum + budget.consumedAmountCents, 0),
    difference: active.reduce((sum, budget) => sum + budget.balanceAmountCents, 0),
    expected: active.every((budget) => typeof budget.residualAmountCents === "number")
      ? active.reduce((sum, budget) => sum + budget.residualAmountCents!, 0) : null,
    free: active.reduce((sum, budget) => sum + budget.balanceAmountCents, 0) - (active.every((budget) => typeof budget.residualAmountCents === "number")
      ? active.reduce((sum, budget) => sum + budget.residualAmountCents!, 0) : 0),
    documentCount: new Set(active.flatMap((budget) => budget.expenses.map((expense) => expense.id))).size,
  };
}

export type BudgetPaceTone = "ok" | "warn" | "danger";

/**
 * Ritmo de um orçamento na competência: quanto do previsto já virou despesa, quanto do mês já passou e o que ainda está livre
 * depois da compra esperada. "Gastando rápido" = consumo acima do tempo decorrido em mais de 15 pontos percentuais.
 */
export function budgetPace(
  budget: Pick<FinancialBudgetSummary, "competenceMonth" | "budgetedAmountCents" | "consumedAmountCents" | "residualAmountCents">,
  today: string,
) {
  const [year, month] = budget.competenceMonth.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = `${budget.competenceMonth}-01`;
  const last = `${budget.competenceMonth}-${String(days).padStart(2, "0")}`;
  const elapsedDays = today < first ? 0 : today > last ? days : Number(today.slice(8, 10));
  const timeRatio = elapsedDays / days;
  const usedRatio = budget.budgetedAmountCents > 0 ? budget.consumedAmountCents / budget.budgetedAmountCents : 0;
  const expectedCents = budget.residualAmountCents ?? 0;
  const freeCents = budget.budgetedAmountCents - budget.consumedAmountCents - expectedCents;
  const over = budget.consumedAmountCents > budget.budgetedAmountCents;
  const tone: BudgetPaceTone = over ? "danger" : usedRatio > timeRatio + 0.15 ? "warn" : "ok";
  return { timeRatio, usedRatio, freeCents, expectedCents, tone, label: tone === "danger" ? "Estourou" : tone === "warn" ? "Gastando rápido" : "No ritmo" };
}

export function budgetExpenseHref(expenseId: string, month: string) {
  return `${FINANCIAL_ROUTES.expenses}?${new URLSearchParams({ expense: expenseId, competence: month })}`;
}
