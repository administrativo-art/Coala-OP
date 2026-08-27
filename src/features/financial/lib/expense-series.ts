export type ExpenseSeriesUpdateScope = "single" | "current-and-future" | "all";

export type ExpenseSeriesEntry = {
  id: string;
  recurrenceIndex?: unknown;
  installmentNumber?: unknown;
  dueDate?: unknown;
  installments?: Array<{ number?: unknown; dueDate?: unknown }>;
};

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function expenseSeriesPosition(expense: ExpenseSeriesEntry): number | null {
  return (
    positiveNumber(expense.recurrenceIndex) ??
    positiveNumber(expense.installmentNumber) ??
    positiveNumber(expense.installments?.[0]?.number)
  );
}

function expenseSeriesDueDate(expense: ExpenseSeriesEntry): Date | null {
  return dateFromUnknown(expense.dueDate) ?? dateFromUnknown(expense.installments?.[0]?.dueDate);
}

export function selectExpenseSeriesEntries<T extends ExpenseSeriesEntry>(
  entries: T[],
  current: ExpenseSeriesEntry,
  scope: ExpenseSeriesUpdateScope
): T[] {
  if (scope === "all") return entries;
  if (scope === "single") return entries.filter((entry) => entry.id === current.id);

  const currentPosition = expenseSeriesPosition(current);
  const currentDueDate = expenseSeriesDueDate(current);

  return entries.filter((entry) => {
    if (entry.id === current.id) return true;

    const entryPosition = expenseSeriesPosition(entry);
    if (currentPosition !== null && entryPosition !== null) {
      return entryPosition >= currentPosition;
    }

    const entryDueDate = expenseSeriesDueDate(entry);
    return !!currentDueDate && !!entryDueDate && entryDueDate >= currentDueDate;
  });
}
