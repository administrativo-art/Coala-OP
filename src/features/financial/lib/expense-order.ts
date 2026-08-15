import { toDate } from "@/features/financial/lib/utils";

export type ExpenseDueDateOrderEntry = {
  dueDate?: unknown;
  description?: unknown;
  id?: unknown;
};

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
