import { accountAllocationsAreValid, expenseAccountAllocations, expenseAccountAllocationsForResultCenter, type ExpenseAccountAllocation } from "./expense-account-allocations";
import { personAllocationsAreValid, type ExpensePersonAllocation } from "./expense-person-allocations";
import { financialExpenseCompetenceMonth } from "./expense-accounting-contract";
import { financialDateKey } from "./financial-dates";
import type { FinancialBudget } from "../budgets/types";

export type BudgetExpense = {
  id: string;
  employeeId?: string | null;
  employeeUserId?: string | null;
  provisionSeriesKey?: string | null;
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
  resultCenter?: string | null;
  isApportioned?: boolean;
  apportionments?: Array<{ resultCenter?: string; percentage?: number }> | null;
  hasPersonAllocations?: boolean;
  personAllocations?: ExpensePersonAllocation[] | null;
  documentIdentity?: unknown;
  fiscalIdentity?: unknown;
  boletoAttachment?: unknown;
  attachments?: unknown;
  documentUrl?: unknown;
  financialInboxMessageId?: unknown;
  sourceDocumentSha256?: unknown;
  sourceReference?: unknown;
  purchaseOrderId?: unknown;
};

export type BudgetConsumptionScope = Pick<FinancialBudget, "accountPlanIds" | "competenceMonth" | "budgetedAmountCents" | "resultCenterId">;

export function isActualBudgetExpense(expense: BudgetExpense) {
  return expense.provisionType !== "forecast" && !["draft", "cancelled", "reconciled"].includes(String(expense.status));
}

/** References must already be resolved to stable IDs at the server boundary. */
export function budgetExpenseAmount(budget: Pick<BudgetConsumptionScope, "accountPlanIds" | "resultCenterId">, expense: BudgetExpense, issues: string[]) {
  const accounts = expenseAccountAllocations(expense).filter((part) => budget.accountPlanIds.includes(part.accountPlanId));
  if (!accounts.length) return 0;
  if ((expense.hasAccountAllocations || (expense.accountAllocations?.length ?? 0) > 0)
    && !accountAllocationsAreValid(expense.accountAllocations, expense.totalValue ?? 0)) {
    issues.push(`Rateio inválido na despesa ${expense.id}.`);
    return 0;
  }
  const validPeople = personAllocationsAreValid(expense);
  if (!validPeople) issues.push(`Parcelas pessoais a identificar na despesa ${expense.id}.`);
  if (!budget.resultCenterId) return accounts.reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
  if (expense.hasPersonAllocations) {
    // Missing identity/center must not redirect a consolidated bill to its administrative header.
    // Validate monetary partitions independently, leaving unclassified portions visible as issues.
    const parts = expense.personAllocations ?? [];
    const classified = personAllocationsAreValid({ ...expense, personAllocations: parts.map((part) => ({ ...part,
      employeeId: part.employeeId || "unidentified", employeeName: part.employeeName || "unidentified",
      resultCenter: part.resultCenter || "unidentified",
    })) });
    if (!classified) {
      issues.push(`Rateio pessoal inválido na despesa ${expense.id}; confira os centros.`);
      const knownSingleCenter = !expense.isApportioned && parts.length > 0 && expense.resultCenter
        && parts.every((part) => part.resultCenter === expense.resultCenter);
      return knownSingleCenter && expense.resultCenter === budget.resultCenterId
        ? accounts.reduce((sum, part) => sum + Math.round(part.amount * 100), 0) : 0;
    }
    if (parts.some((part) => !part.resultCenter)) issues.push(`Centro a identificar na despesa ${expense.id}.`);
    return parts.filter((part) => part.resultCenter === budget.resultCenterId && budget.accountPlanIds.includes(part.accountPlanId))
      .reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
  }
  // Invalid personal detail cannot erase a reliably classified document total.
  const scoped = validPeople ? expense : { ...expense, hasPersonAllocations: false, personAllocations: null };
  if (!scoped.hasPersonAllocations) {
    if (scoped.isApportioned) {
      const parts = scoped.apportionments ?? [];
      if (!parts.length || parts.some((part) => !part.resultCenter || !Number.isFinite(part.percentage) || Number(part.percentage) < 0)
        || Math.abs(parts.reduce((sum, part) => sum + Number(part.percentage), 0) - 100) > 0.001
        || new Set(parts.map((part) => part.resultCenter)).size !== parts.length) {
        issues.push(`Centro/rateio a identificar na despesa ${expense.id}.`);
        return 0;
      }
      // Existing percentages, with deterministic cent reconciliation across ALL centers.
      // Independent rounding would duplicate a cent across unit envelopes.
      return accounts.reduce((total, account) => {
        const cents = Math.round(account.amount * 100);
        const shares = parts.map((part) => ({ center: part.resultCenter!, raw: cents * Number(part.percentage) / 100 }));
        const values = shares.map((part) => Math.floor(part.raw));
        const order = shares.map((part, index) => ({ index, fraction: part.raw - values[index], center: part.center }))
          .sort((a, b) => b.fraction - a.fraction || a.center.localeCompare(b.center));
        const remaining = cents - values.reduce((sum, amount) => sum + amount, 0);
        for (let index = 0; index < remaining; index++) values[order[index % order.length].index]++;
        return total + shares.reduce((sum, part, index) => sum + (part.center === budget.resultCenterId ? values[index] : 0), 0);
      }, 0);
    }
    if (!scoped.resultCenter) issues.push(`Centro a identificar na despesa ${expense.id}.`);
  }
  return expenseAccountAllocationsForResultCenter(scoped, budget.resultCenterId)
    .filter((part) => budget.accountPlanIds.includes(part.accountPlanId))
    .reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
}

function dateKey(value: unknown): string | null {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  const date = value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date ? value : null;
  return date && !Number.isNaN(date.getTime()) ? financialDateKey(date) : financialDateKey(value);
}

export function calculateBudgetConsumption(budget: BudgetConsumptionScope, expenses: BudgetExpense[]) {
  const issues: string[] = [];
  const matching = expenses.flatMap((expense) => {
    if (financialExpenseCompetenceMonth(expense) !== budget.competenceMonth) return [];
    if (!isActualBudgetExpense(expense)) return [];
    const amountCents = budgetExpenseAmount(budget, expense, issues);
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
  budget: Pick<FinancialBudget, "accountPlanIds" | "competenceMonth" | "resultCenterId" | "composition">,
  expenses: BudgetExpense[],
) {
  if (budget.composition?.length) return 0; // Residual projections own composed expectations.
  return expenses.filter((expense) => financialExpenseCompetenceMonth(expense) === budget.competenceMonth
    && expense.provisionType === "forecast" && expense.status === "provisioned")
    .reduce((sum, expense) => sum + budgetExpenseAmount(budget, expense, []), 0);
}

export function buildBudgetBurndownData(
  budget: BudgetConsumptionScope,
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
