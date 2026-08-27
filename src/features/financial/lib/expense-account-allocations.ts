import { expenseValueForResultCenter, type ResultCenterNameMap } from "./expense-rateio";
import { expensePersonAllocations, type ExpensePersonAllocation } from "./expense-person-allocations";

export type ExpenseAccountAllocation = {
  accountPlanId: string;
  accountPlanName?: string | null;
  amount: number;
};

type ExpenseWithAccountAllocations = {
  accountPlan?: string | null;
  accountId?: string | null;
  accountPlanName?: string | null;
  totalValue?: number;
  hasAccountAllocations?: boolean;
  accountAllocations?: ExpenseAccountAllocation[] | null;
  isApportioned?: boolean;
  resultCenter?: string | null;
  apportionments?: Array<{ resultCenter?: string; percentage?: number }> | null;
  hasPersonAllocations?: boolean;
  personAllocations?: ExpensePersonAllocation[] | null;
};

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

export function accountAllocationTotal(allocations: ExpenseAccountAllocation[] | null | undefined) {
  return (allocations || []).reduce((total, allocation) => total + cents(allocation.amount), 0) / 100;
}

export function accountAllocationDifference(
  allocations: ExpenseAccountAllocation[] | null | undefined,
  totalValue: number,
) {
  return (cents(totalValue) - cents(accountAllocationTotal(allocations))) / 100;
}

export function accountAllocationsAreValid(
  allocations: ExpenseAccountAllocation[] | null | undefined,
  totalValue: number,
) {
  if (!allocations || allocations.length < 2) return false;
  const ids = allocations.map((allocation) => allocation.accountPlanId?.trim()).filter(Boolean);
  if (ids.length !== allocations.length || new Set(ids).size !== ids.length) return false;
  if (allocations.some((allocation) => cents(allocation.amount) <= 0)) return false;
  return cents(accountAllocationTotal(allocations)) === cents(totalValue);
}

export function expenseAccountAllocations(
  expense: ExpenseWithAccountAllocations,
  accountNames: Record<string, string> = {},
): ExpenseAccountAllocation[] {
  const stored = Array.isArray(expense.accountAllocations)
    ? expense.accountAllocations
        .map((allocation) => ({
          accountPlanId: String(allocation?.accountPlanId ?? "").trim(),
          accountPlanName:
            accountNames[String(allocation?.accountPlanId ?? "").trim()]
            || String(allocation?.accountPlanName ?? "").trim()
            || null,
          amount: cents(allocation?.amount) / 100,
        }))
        .filter((allocation) => allocation.accountPlanId && allocation.amount > 0)
    : [];

  if (stored.length > 0) return stored;

  const accountPlanId = String(expense.accountId ?? expense.accountPlan ?? "").trim();
  if (!accountPlanId) return [];
  return [{
    accountPlanId,
    accountPlanName: accountNames[accountPlanId] || expense.accountPlanName || accountPlanId,
    amount: cents(expense.totalValue) / 100,
  }];
}

export function expenseAccountAllocationsForResultCenter(
  expense: ExpenseWithAccountAllocations,
  resultCenter?: string | null,
  resultCenterNames: ResultCenterNameMap = {},
  accountNames: Record<string, string> = {},
) {
  const accountingAllocations = expenseAccountAllocations(expense, accountNames);
  const personAllocations = expensePersonAllocations(expense, accountNames);

  return accountingAllocations.map((allocation) => {
    if (!resultCenter) return allocation;
    if (personAllocations.length === 0) {
      return {
        ...allocation,
        amount: expenseValueForResultCenter(
          { ...expense, totalValue: allocation.amount },
          resultCenter,
          resultCenterNames,
        ),
      };
    }
    const amount = personAllocations
      .filter((personAllocation) => personAllocation.accountPlanId === allocation.accountPlanId)
      .reduce((total, personAllocation) => {
        if (personAllocation.resultCenter) {
          const storedName = resultCenterNames[personAllocation.resultCenter] || personAllocation.resultCenter;
          return storedName === resultCenter ? total + personAllocation.amount : total;
        }
        return total + expenseValueForResultCenter(
          { ...expense, totalValue: personAllocation.amount, hasPersonAllocations: false, personAllocations: null },
          resultCenter,
          resultCenterNames,
        );
      }, 0);
    return { ...allocation, amount: Number(amount.toFixed(2)) };
  });
}

export function expenseAccountPlanLabels(
  expense: ExpenseWithAccountAllocations,
  accountNames: Record<string, string> = {},
): string[] {
  return expenseAccountAllocations(expense, accountNames)
    .map((allocation) => allocation.accountPlanName || allocation.accountPlanId)
    .filter((label): label is string => typeof label === "string" && label.length > 0);
}
