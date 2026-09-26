/** Client-safe reporting contracts: no employee IDs or personal snapshots. */
export type BudgetCashProjection = {
  id: string; budgetId: string; description: string; resultCenterId: string; resultCenterName: string;
  accountPlanId: string; competenceMonth: string; date: string; amountCents: number; requiresReview: boolean;
};
export type ProjectCashProjection = { id: string; projectId: string; description: string; date: string; amountCents: number; requiresReview: boolean; accountPlanIds: string[] };
export type BudgetCashProjectionPayload = { projections: BudgetCashProjection[]; conflictCount: number; issueCount: number;
  projectProjections?: ProjectCashProjection[]; projectAccountPlanIds?: string[]; projectIssues?: string[] };
export type BudgetPlanningComparison = {
  id: string; name: string; competenceMonth: string; resultCenterId: string; resultCenterName: string; unitIds: string[];
  budgetedAmountCents: number; committedAmountCents: number; balanceAmountCents: number; residualAmountCents: number;
  conflictCount: number; issueCount: number;
};

export function budgetScenarioAmount(budget: { hasComposition?: boolean; composition?: unknown[]; balanceAmountCents: number; forecastCoverageAmountCents: number }) {
  return budget.hasComposition || budget.composition?.length ? 0 : Math.max(0, budget.balanceAmountCents - budget.forecastCoverageAmountCents);
}

/** Legacy forecasts have no reliable project link: suspend, never silently cancel or add both. */
export function selectProjectCashProjections(projections: ProjectCashProjection[], legacyAccountIds: string[]) {
  const legacy = new Set(legacyAccountIds);
  const conflicts = new Set(projections.filter((row) => row.accountPlanIds.some((id) => legacy.has(id))).map((row) => row.projectId));
  const selected = projections.filter((row) => !conflicts.has(row.projectId));
  return { projections: selected, conflictCount: conflicts.size, accountPlanIds: [...new Set(selected.flatMap((row) => row.accountPlanIds))] };
}

export function cashForecastTotals(rows: Array<{ amount: number; source?: string }>) {
  return rows.reduce((totals, row) => {
    if (row.source === "budget_scenario") totals.scenario += row.amount;
    else if (row.source === "budget_residual" || row.source === "expense_forecast" || row.source === "project_residual") totals.planning += row.amount;
    else totals.payable += row.amount;
    return totals;
  }, { payable: 0, planning: 0, scenario: 0 });
}
