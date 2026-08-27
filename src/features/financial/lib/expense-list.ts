import { endOfWeek, format, startOfWeek } from "date-fns";

export type ExpenseDueWeekGroup<T> = {
  key: string;
  label: string;
  startDate: Date | null;
  endDate: Date | null;
  expenses: T[];
  totalValue: number;
};

export function compareExpenseCompetenceMonths(left: string, right: string) {
  return right.localeCompare(left);
}

type ConsolidatableExpense = {
  id?: unknown;
  status?: unknown;
  provisionType?: unknown;
  replacedByExpenseId?: unknown;
};

export function consolidateExpenseObligations<T extends ConsolidatableExpense>(expenses: T[]) {
  const availableIds = new Set(
    expenses
      .map((expense) => String(expense.id ?? "").trim())
      .filter(Boolean),
  );

  return expenses.filter((expense) => {
    const replacementId = String(expense.replacedByExpenseId ?? "").trim();
    const isReconciledForecast =
      expense.provisionType === "forecast" &&
      expense.status === "reconciled" &&
      replacementId.length > 0;

    return !isReconciledForecast || !availableIds.has(replacementId);
  });
}

function weekRangeLabel(startDate: Date, endDate: Date) {
  if (startDate.getFullYear() !== endDate.getFullYear()) {
    return `${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`;
  }
  if (startDate.getMonth() !== endDate.getMonth()) {
    return `${format(startDate, "dd/MM")} a ${format(endDate, "dd/MM/yyyy")}`;
  }
  return `${format(startDate, "dd")} a ${format(endDate, "dd/MM/yyyy")}`;
}

export function groupExpensesByDueWeek<T>(
  expenses: T[],
  getDueDate: (expense: T) => Date | null,
  getValue: (expense: T) => number,
): ExpenseDueWeekGroup<T>[] {
  const groups = new Map<string, ExpenseDueWeekGroup<T>>();

  expenses.forEach((expense) => {
    const dueDate = getDueDate(expense);
    const startDate = dueDate ? startOfWeek(dueDate, { weekStartsOn: 1 }) : null;
    const endDate = dueDate ? endOfWeek(dueDate, { weekStartsOn: 1 }) : null;
    const key = startDate ? format(startDate, "yyyy-MM-dd") : "without-due-date";
    const current = groups.get(key) ?? {
      key,
      label: startDate && endDate ? weekRangeLabel(startDate, endDate) : "Sem vencimento definido",
      startDate,
      endDate,
      expenses: [],
      totalValue: 0,
    };

    current.expenses.push(expense);
    current.totalValue = Number((current.totalValue + (Number(getValue(expense)) || 0)).toFixed(2));
    groups.set(key, current);
  });

  return [...groups.values()].sort((left, right) => {
    if (!left.startDate) return 1;
    if (!right.startDate) return -1;
    return left.startDate.getTime() - right.startDate.getTime();
  });
}
