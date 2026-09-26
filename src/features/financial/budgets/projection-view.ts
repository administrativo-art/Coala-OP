/** Client-safe reporting contracts: no employee IDs or personal snapshots. */
export type BudgetCashProjection = {
  id: string; budgetId: string; description: string; resultCenterId: string; resultCenterName: string;
  accountPlanId: string; competenceMonth: string; date: string; amountCents: number; requiresReview: boolean;
};
export type BudgetCashProjectionPayload = { projections: BudgetCashProjection[]; conflictCount: number; issueCount: number };
export type BudgetPlanningComparison = {
  id: string; name: string; competenceMonth: string; resultCenterId: string; resultCenterName: string; unitIds: string[];
  budgetedAmountCents: number; committedAmountCents: number; balanceAmountCents: number; residualAmountCents: number;
  conflictCount: number; issueCount: number;
};

export function budgetScenarioAmount(budget: { hasComposition?: boolean; composition?: unknown[]; balanceAmountCents: number; forecastCoverageAmountCents: number }) {
  return budget.hasComposition || budget.composition?.length ? 0 : Math.max(0, budget.balanceAmountCents - budget.forecastCoverageAmountCents);
}

export function cashForecastTotals(rows: Array<{ amount: number; source?: string }>) {
  return rows.reduce((totals, row) => {
    if (row.source === "budget_scenario") totals.scenario += row.amount;
    else if (row.source === "budget_residual" || row.source === "expense_forecast") totals.planning += row.amount;
    else totals.payable += row.amount;
    return totals;
  }, { payable: 0, planning: 0, scenario: 0 });
}
