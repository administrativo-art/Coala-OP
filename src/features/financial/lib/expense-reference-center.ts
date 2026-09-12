export const ADMIN_REFERENCE_RESULT_CENTER = {
  id: "KNKNWZ7tdhIxnrlStRum",
  name: "Centro administrativo - Renascença",
} as const;

export type ExpenseReferenceCenter = {
  id: string;
  name: string;
};

export type ExpenseReferenceCenterSource = {
  referenceResultCenterId?: unknown;
  referenceResultCenterName?: unknown;
  resultCenterId?: unknown;
  resultCenterName?: unknown;
  resultCenter?: unknown;
  isApportioned?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveExpenseReferenceCenter(
  expense: ExpenseReferenceCenterSource,
  namesById: Record<string, string> = {},
): ExpenseReferenceCenter | null {
  const explicitId = text(expense.referenceResultCenterId);
  const explicitName = text(expense.referenceResultCenterName);
  if (explicitId || explicitName) {
    return {
      id: explicitId,
      name: explicitName || namesById[explicitId] || explicitId,
    };
  }

  const legacyId = text(expense.resultCenterId);
  const legacyName = text(expense.resultCenterName);
  const legacyValue = text(expense.resultCenter);
  const resolvedId = legacyId || (namesById[legacyValue] ? legacyValue : "");
  const resolvedName = legacyName || namesById[resolvedId] || legacyValue;
  if (!resolvedId && !resolvedName) {
    return expense.isApportioned === true ? ADMIN_REFERENCE_RESULT_CENTER : null;
  }

  return { id: resolvedId, name: resolvedName || resolvedId };
}

export function expenseReferenceCenterLabel(
  expense: ExpenseReferenceCenterSource,
  namesById: Record<string, string> = {},
) {
  return resolveExpenseReferenceCenter(expense, namesById)?.name || "—";
}

export function expenseReferenceCenterFields(center: ExpenseReferenceCenter | null | undefined) {
  const id = text(center?.id);
  const name = text(center?.name);
  return {
    referenceResultCenterId: id || null,
    referenceResultCenterName: name || null,
  };
}

export function inheritExpenseReferenceCenter(
  target: ExpenseReferenceCenterSource,
  source: ExpenseReferenceCenterSource,
  namesById: Record<string, string> = {},
) {
  const targetHasClassification = [
    target.referenceResultCenterId,
    target.referenceResultCenterName,
    target.resultCenterId,
    target.resultCenterName,
    target.resultCenter,
  ].some((value) => text(value).length > 0);
  const current = targetHasClassification ? resolveExpenseReferenceCenter(target, namesById) : null;
  return expenseReferenceCenterFields(
    current || resolveExpenseReferenceCenter(source, namesById) || resolveExpenseReferenceCenter(target, namesById),
  );
}
