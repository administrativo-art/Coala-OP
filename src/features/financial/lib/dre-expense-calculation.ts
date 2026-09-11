import {
  accountAllocationDifference,
  expenseAccountAllocations,
  expenseAccountAllocationsForResultCenter,
} from "./expense-account-allocations";
import {
  financialExpenseCompetenceMonth,
  financialExpenseParticipatesInDre,
  type FinancialExpenseDreDocument,
} from "./expense-accounting-contract";
import { personAllocationsAreValid } from "./expense-person-allocations";
import type { ResultCenterNameMap } from "./expense-rateio";

export type DreExpenseAccountMeta = {
  name: string;
  drePosition: string | null;
  isDreAccount: boolean;
};

export type DreExpenseContractIssueCode =
  | "missing_account"
  | "unknown_account"
  | "account_allocation_mismatch"
  | "invalid_person_allocations"
  | "missing_result_center"
  | "unknown_result_center"
  | "apportionment_mismatch";

export type DreExpenseContractIssue = {
  expenseId: string;
  code: DreExpenseContractIssueCode;
  differenceCents?: number;
};

export type DreExpenseCalculation = {
  totalsByPosition: Record<string, number>;
  issues: DreExpenseContractIssue[];
};

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

function resultCenterReferences(expense: FinancialExpenseDreDocument) {
  if (expense.hasPersonAllocations && Array.isArray(expense.personAllocations)) {
    return expense.personAllocations.map((allocation) => allocation.resultCenter).filter(Boolean) as string[];
  }
  if (expense.isApportioned) {
    return (expense.apportionments || []).map((allocation) => allocation.resultCenter).filter(Boolean) as string[];
  }
  return expense.resultCenter ? [expense.resultCenter] : [];
}

export function calculateDreExpenses(input: {
  expenses: FinancialExpenseDreDocument[];
  accounts: Record<string, DreExpenseAccountMeta>;
  monthKey: string;
  resultCenter?: string | null;
  resultCenterNames?: ResultCenterNameMap;
}): DreExpenseCalculation {
  const totalsInCents: Record<string, number> = {};
  const issues = new Map<string, DreExpenseContractIssue>();
  const resultCenterNames = input.resultCenterNames ?? {};
  const knownResultCenters = new Set([
    ...Object.keys(resultCenterNames),
    ...Object.values(resultCenterNames),
  ]);

  function addIssue(issue: DreExpenseContractIssue) {
    issues.set(`${issue.expenseId}:${issue.code}`, issue);
  }

  for (const expense of input.expenses) {
    if (!financialExpenseParticipatesInDre(expense)) continue;
    if (financialExpenseCompetenceMonth(expense) !== input.monthKey) continue;

    const allocations = expenseAccountAllocations(expense);
    if (allocations.length === 0) {
      addIssue({ expenseId: expense.id, code: "missing_account" });
      continue;
    }

    const dreAllocations = allocations.filter((allocation) => {
      const account = input.accounts[allocation.accountPlanId];
      if (!account) {
        addIssue({ expenseId: expense.id, code: "unknown_account" });
        return false;
      }
      return account.isDreAccount;
    });
    if (dreAllocations.length === 0) continue;

    if (expense.hasAccountAllocations || (expense.accountAllocations?.length ?? 0) > 0) {
      const differenceCents = cents(accountAllocationDifference(expense.accountAllocations, expense.totalValue));
      if (differenceCents !== 0) {
        addIssue({ expenseId: expense.id, code: "account_allocation_mismatch", differenceCents });
      }
    }
    if (expense.hasPersonAllocations && !personAllocationsAreValid(expense)) {
      addIssue({ expenseId: expense.id, code: "invalid_person_allocations" });
    }

    const centerReferences = resultCenterReferences(expense);
    if (centerReferences.length === 0) {
      addIssue({ expenseId: expense.id, code: "missing_result_center" });
    } else if (centerReferences.some((center) => !knownResultCenters.has(center))) {
      addIssue({ expenseId: expense.id, code: "unknown_result_center" });
    }
    if (expense.isApportioned && !expense.hasPersonAllocations) {
      const percentage = (expense.apportionments || []).reduce((total, allocation) => total + (Number(allocation.percentage) || 0), 0);
      if (Math.abs(percentage - 100) > 0.001) {
        addIssue({ expenseId: expense.id, code: "apportionment_mismatch" });
      }
    }

    const allocatedForCenter = expenseAccountAllocationsForResultCenter(
      expense,
      input.resultCenter,
      resultCenterNames,
    );
    for (const allocation of allocatedForCenter) {
      const account = input.accounts[allocation.accountPlanId];
      if (!account?.isDreAccount) continue;
      const position = account.drePosition ?? "null";
      totalsInCents[position] = (totalsInCents[position] || 0) + cents(allocation.amount);
    }
  }

  return {
    totalsByPosition: Object.fromEntries(
      Object.entries(totalsInCents).map(([position, total]) => [position, total / 100]),
    ),
    issues: [...issues.values()],
  };
}
