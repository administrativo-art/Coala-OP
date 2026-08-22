export const PERSON_ALLOCATION_ANALYSIS_TYPES = [
  "employer_cost",
  "employee_deduction",
  "informational",
] as const;

export type PersonAllocationAnalysisType = (typeof PERSON_ALLOCATION_ANALYSIS_TYPES)[number];

export type ExpensePersonAllocation = {
  id?: string | null;
  accountPlanId: string;
  accountPlanName?: string | null;
  employeeId: string;
  employeeName?: string | null;
  analysisType: PersonAllocationAnalysisType;
  amount: number;
  resultCenter?: string | null;
  payrollDocumentId?: string | null;
  contractReference?: string | null;
  creditorName?: string | null;
};

type AccountAllocationLike = {
  accountPlanId?: string | null;
  amount?: number | null;
};

export type ExpenseWithPersonAllocations = {
  accountPlan?: string | null;
  accountId?: string | null;
  totalValue?: number | null;
  hasAccountAllocations?: boolean;
  accountAllocations?: AccountAllocationLike[] | null;
  hasPersonAllocations?: boolean;
  personAllocations?: ExpensePersonAllocation[] | null;
};

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function personAllocationTotal(allocations: ExpensePersonAllocation[] | null | undefined) {
  return (allocations || []).reduce((total, allocation) => total + cents(allocation.amount), 0) / 100;
}

export function personAllocationDifference(
  allocations: ExpensePersonAllocation[] | null | undefined,
  totalValue: number,
) {
  return (cents(totalValue) - cents(personAllocationTotal(allocations))) / 100;
}

export function personAllocationDistinctPeopleCount(
  allocations: ExpensePersonAllocation[] | null | undefined,
) {
  return new Set(
    (allocations || [])
      .map((allocation) => text(allocation.employeeId) || text(allocation.employeeName).toLocaleLowerCase("pt-BR"))
      .filter(Boolean),
  ).size;
}

export function personAllocationAccountTotals(
  allocations: ExpensePersonAllocation[] | null | undefined,
) {
  const totals = new Map<string, number>();
  (allocations || []).forEach((allocation) => {
    const accountPlanId = text(allocation.accountPlanId);
    if (!accountPlanId) return;
    totals.set(accountPlanId, (totals.get(accountPlanId) || 0) + cents(allocation.amount));
  });
  return new Map(Array.from(totals, ([accountPlanId, total]) => [accountPlanId, total / 100]));
}

export function personAllocationsAreValid(expense: ExpenseWithPersonAllocations) {
  if (expense.hasPersonAllocations !== true) return true;

  const allocations = Array.isArray(expense.personAllocations) ? expense.personAllocations : [];
  if (allocations.length === 0) return false;
  if (allocations.some((allocation) => (
    !text(allocation.accountPlanId)
    || !text(allocation.employeeId)
    || !text(allocation.employeeName)
    || !text(allocation.resultCenter)
    || !PERSON_ALLOCATION_ANALYSIS_TYPES.includes(allocation.analysisType)
    || cents(allocation.amount) <= 0
  ))) return false;

  if (cents(personAllocationTotal(allocations)) !== cents(expense.totalValue)) return false;

  const expectedAccounts = expense.hasAccountAllocations === true
    ? (expense.accountAllocations || []).map((allocation) => ({
        accountPlanId: text(allocation.accountPlanId),
        amount: cents(allocation.amount),
      }))
    : [{
        accountPlanId: text(expense.accountId ?? expense.accountPlan),
        amount: cents(expense.totalValue),
      }];

  if (expectedAccounts.some((allocation) => !allocation.accountPlanId || allocation.amount <= 0)) return false;
  const expectedIds = new Set(expectedAccounts.map((allocation) => allocation.accountPlanId));
  if (allocations.some((allocation) => !expectedIds.has(text(allocation.accountPlanId)))) return false;

  const actualTotals = personAllocationAccountTotals(allocations);
  return expectedAccounts.every((allocation) => (
    cents(actualTotals.get(allocation.accountPlanId)) === allocation.amount
  ));
}

export function expensePersonAllocations(
  expense: ExpenseWithPersonAllocations,
  accountNames: Record<string, string> = {},
) {
  if (expense.hasPersonAllocations !== true || !Array.isArray(expense.personAllocations)) return [];
  return expense.personAllocations
    .map((allocation) => {
      const accountPlanId = text(allocation.accountPlanId);
      return {
        id: text(allocation.id) || null,
        accountPlanId,
        accountPlanName: accountNames[accountPlanId] || text(allocation.accountPlanName) || accountPlanId,
        employeeId: text(allocation.employeeId),
        employeeName: text(allocation.employeeName),
        analysisType: PERSON_ALLOCATION_ANALYSIS_TYPES.includes(allocation.analysisType)
          ? allocation.analysisType
          : "informational" as const,
        amount: cents(allocation.amount) / 100,
        resultCenter: text(allocation.resultCenter) || null,
        payrollDocumentId: text(allocation.payrollDocumentId) || null,
        contractReference: text(allocation.contractReference) || null,
        creditorName: text(allocation.creditorName) || null,
      };
    })
    .filter((allocation) => allocation.accountPlanId && allocation.employeeId && allocation.amount > 0);
}
