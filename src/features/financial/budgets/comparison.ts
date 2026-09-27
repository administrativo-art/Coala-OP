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
    documentCount: new Set(active.flatMap((budget) => budget.expenses.map((expense) => expense.id))).size,
  };
}

export function budgetExpenseHref(expenseId: string, month: string) {
  return `${FINANCIAL_ROUTES.expenses}?${new URLSearchParams({ expense: expenseId, competence: month })}`;
}
