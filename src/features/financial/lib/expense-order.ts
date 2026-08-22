import { toDate } from "@/features/financial/lib/utils";

export type ExpenseDueDateOrderEntry = {
  dueDate?: unknown;
  totalValue?: unknown;
  description?: unknown;
  id?: unknown;
};

export type ExpenseSortDirection = "asc" | "desc";

function compareText(left: unknown, right: unknown) {
  return String(left ?? "").localeCompare(String(right ?? ""), "pt-BR", {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Orders expenses chronologically by due date. Entries without a valid due date
 * stay at the end, and same-day entries receive deterministic text tie-breakers.
 */
export function compareExpensesByDueDate(
  left: ExpenseDueDateOrderEntry,
  right: ExpenseDueDateOrderEntry
) {
  const leftDueAt = toDate(left.dueDate)?.getTime();
  const rightDueAt = toDate(right.dueDate)?.getTime();
  const leftHasDueDate = Number.isFinite(leftDueAt);
  const rightHasDueDate = Number.isFinite(rightDueAt);

  if (leftHasDueDate && rightHasDueDate && leftDueAt !== rightDueAt) {
    return leftDueAt! - rightDueAt!;
  }
  if (leftHasDueDate !== rightHasDueDate) {
    return leftHasDueDate ? -1 : 1;
  }

  return compareText(left.description, right.description) || compareText(left.id, right.id);
}

export function compareExpensesByDueDateDirection(
  left: ExpenseDueDateOrderEntry,
  right: ExpenseDueDateOrderEntry,
  direction: ExpenseSortDirection,
) {
  const leftDueAt = toDate(left.dueDate)?.getTime();
  const rightDueAt = toDate(right.dueDate)?.getTime();
  const leftHasDueDate = Number.isFinite(leftDueAt);
  const rightHasDueDate = Number.isFinite(rightDueAt);

  if (leftHasDueDate && rightHasDueDate && leftDueAt !== rightDueAt) {
    const comparison = leftDueAt! - rightDueAt!;
    return direction === "asc" ? comparison : -comparison;
  }
  if (leftHasDueDate !== rightHasDueDate) {
    return leftHasDueDate ? -1 : 1;
  }

  return compareText(left.description, right.description) || compareText(left.id, right.id);
}

export function compareExpensesByValue(
  left: ExpenseDueDateOrderEntry,
  right: ExpenseDueDateOrderEntry,
  direction: ExpenseSortDirection,
) {
  const leftValue = Number(left.totalValue);
  const rightValue = Number(right.totalValue);
  const leftHasValue = Number.isFinite(leftValue);
  const rightHasValue = Number.isFinite(rightValue);

  if (leftHasValue && rightHasValue && leftValue !== rightValue) {
    const comparison = leftValue - rightValue;
    return direction === "asc" ? comparison : -comparison;
  }
  if (leftHasValue !== rightHasValue) {
    return leftHasValue ? -1 : 1;
  }

  return compareText(left.description, right.description) || compareText(left.id, right.id);
}
