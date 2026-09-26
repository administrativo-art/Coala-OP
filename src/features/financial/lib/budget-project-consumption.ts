import { accountAllocationsAreValid, expenseAccountAllocations } from "./expense-account-allocations";
import { financialExpenseCompetenceMonth } from "./expense-accounting-contract";
import type { BudgetExpense } from "./budget-consumption";
import type { FinancialBudgetProject } from "../budgets/types";

export function calculateProjectBudgetConsumption(
  project: Pick<FinancialBudgetProject, "accountPlanIds" | "startMonth" | "endMonth" | "budgetedAmountCents" | "periodMode">,
  expenses: BudgetExpense[],
) {
  const accountIds = new Set(project.accountPlanIds);
  const issues: string[] = [];
  const matching = expenses.flatMap((expense) => {
    const competenceMonth = financialExpenseCompetenceMonth(expense);
    if (!competenceMonth) { issues.push(`Despesa ${expense.id} sem competência.`); return []; }
    if (competenceMonth < project.startMonth || competenceMonth > project.endMonth) {
      issues.push(`Despesa ${expense.id} fora do período do projeto.`);
      if (project.periodMode !== "date_range") return [];
    }
    if (["draft", "cancelled", "reconciled"].includes(String(expense.status)) || expense.provisionType === "forecast") return [];
    if ((expense.hasAccountAllocations || (expense.accountAllocations?.length ?? 0) > 0)
      && !accountAllocationsAreValid(expense.accountAllocations, expense.totalValue ?? 0)) {
      issues.push(`Rateio inválido na despesa ${expense.id}.`); return [];
    }
    const amountCents = expenseAccountAllocations(expense)
      .filter((item) => accountIds.has(item.accountPlanId))
      .reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    if (!amountCents) { issues.push(`Despesa ${expense.id} sem valor nas contas do projeto.`); return []; }
    return [{ id: expense.id, description: expense.description || "Despesa sem descrição", amountCents, competenceMonth }];
  });
  const consumedAmountCents = matching.reduce((sum, item) => sum + item.amountCents, 0);
  return { consumedAmountCents, balanceAmountCents: project.budgetedAmountCents - consumedAmountCents,
    expenses: matching, issues };
}
