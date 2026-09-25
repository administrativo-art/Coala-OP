import { accountAllocationsAreValid, expenseAccountAllocations, type ExpenseAccountAllocation } from "./expense-account-allocations";
import { financialExpenseCompetenceMonth } from "./expense-accounting-contract";
import { financialDateKey } from "./financial-dates";
import type { FinancialBudget } from "../budgets/types";

export type BudgetExpense = {
  id: string;
  description?: string | null;
  status?: string | null;
  provisionType?: string | null;
  totalValue?: number;
  accountId?: string | null;
  accountPlan?: string | null;
  hasAccountAllocations?: boolean;
  accountAllocations?: ExpenseAccountAllocation[] | null;
  competenceMonth?: string | null;
  provisionCompetence?: string | null;
  competenceDate?: unknown;
  createdAt?: unknown;
};

function dateKey(value: unknown): string | null {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  const date = value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date ? value : null;
  return date && !Number.isNaN(date.getTime()) ? financialDateKey(date) : financialDateKey(value);
}

export function calculateBudgetConsumption(budget: Pick<FinancialBudget, "accountPlanIds" | "competenceMonth" | "budgetedAmountCents">, expenses: BudgetExpense[]) {
  const accountIds = new Set(budget.accountPlanIds);
  const issues: string[] = [];
  const matching = expenses.flatMap((expense) => {
    if (financialExpenseCompetenceMonth(expense) !== budget.competenceMonth) return [];
    if (["draft", "cancelled", "reconciled"].includes(String(expense.status))) return [];
    if (expense.provisionType === "forecast") return [];
    if ((expense.hasAccountAllocations || (expense.accountAllocations?.length ?? 0) > 0)
      && !accountAllocationsAreValid(expense.accountAllocations, expense.totalValue ?? 0)) {
      issues.push(`Rateio inválido na despesa ${expense.id}.`);
      return [];
    }
    const amountCents = expenseAccountAllocations(expense)
      .filter((part) => accountIds.has(part.accountPlanId))
      .reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
    if (!amountCents) return [];
    const competenceDay = dateKey(expense.competenceDate);
    const createdDay = dateKey(expense.createdAt);
    const day = competenceDay?.startsWith(budget.competenceMonth) ? competenceDay
      : createdDay?.startsWith(budget.competenceMonth) ? createdDay
      : `${budget.competenceMonth}-01`;
    return [{ id: expense.id, description: expense.description || "Despesa sem descrição", amountCents, impactDate: day }];
  });
  const consumedAmountCents = matching.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    consumedAmountCents,
    balanceAmountCents: budget.budgetedAmountCents - consumedAmountCents,
    usageRatio: budget.budgetedAmountCents > 0 ? consumedAmountCents / budget.budgetedAmountCents : 0,
    expenses: matching,
    issues,
  };
}

export function calculateBudgetForecastCoverage(
  budget: Pick<FinancialBudget, "accountPlanIds" | "competenceMonth">,
  expenses: BudgetExpense[],
) {
  const accountIds = new Set(budget.accountPlanIds);
  return expenses.filter((expense) => financialExpenseCompetenceMonth(expense) === budget.competenceMonth
    && expense.provisionType === "forecast" && expense.status === "provisioned")
    .reduce((sum, expense) => sum + expenseAccountAllocations(expense)
      .filter((part) => accountIds.has(part.accountPlanId))
      .reduce((subtotal, part) => subtotal + Math.round(part.amount * 100), 0), 0);
}

export function buildBudgetBurndownData(
  budget: Pick<FinancialBudget, "accountPlanIds" | "competenceMonth" | "budgetedAmountCents">,
  expenses: BudgetExpense[],
  referenceDate: string,
) {
  const { expenses: matching } = calculateBudgetConsumption(budget, expenses);
  const [year, month] = budget.competenceMonth.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const key = `${budget.competenceMonth}-${String(day).padStart(2, "0")}`;
    const consumed = matching.filter((expense) => expense.impactDate <= key).reduce((sum, expense) => sum + expense.amountCents, 0);
    return {
      key,
      day: String(day).padStart(2, "0"),
      plannedBalanceCents: Math.round(budget.budgetedAmountCents * (1 - day / days)),
      actualBalanceCents: key <= referenceDate ? budget.budgetedAmountCents - consumed : null,
    };
  });
}
