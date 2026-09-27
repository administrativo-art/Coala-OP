import { financialDateKey } from "./financial-dates";

type ExpenseState = {
  status?: string; paymentState?: string; provisionType?: string; originModule?: string; originStatus?: string;
  dueDate?: unknown; totalValue?: number; budgetMigration?: unknown;
  settlementSummary?: { reconciliationStatus?: string; balanceAmountCents?: number | null;
    principalSettledAmountCents?: number; settlementCreditsAmountCents?: number } | null;
};
const cents = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

export function expenseAwaitingConfirmation(expense: ExpenseState) {
  return !["cancelled", "reconciled"].includes(expense.status ?? "") && (
    expense.paymentState === "payment_found_pending_document"
    || expense.settlementSummary?.reconciliationStatus === "PENDING_DOCUMENT"
  );
}

/** A confirmed debit remains evidence even while the expense is still a forecast. */
export function expenseCashForecastAmount(expense: ExpenseState) {
  if (["paid", "draft", "cancelled", "reconciled"].includes(expense.status ?? "")) return 0;
  const summary = expense.settlementSummary;
  if (summary?.balanceAmountCents != null) return cents(summary.balanceAmountCents) / 100;
  return Math.max(0, cents(Number(expense.totalValue) * 100)
    - cents(summary?.principalSettledAmountCents) - cents(summary?.settlementCreditsAmountCents)) / 100;
}

export function expenseDisplayStatus(expense: ExpenseState, now: Date) {
  if (["cancelled", "reconciled"].includes(expense.status ?? "")) return expense.status!;
  if (expenseAwaitingConfirmation(expense)) return "payment_found_pending_document";
  if (["reported_paid", "paid_divergent"].includes(expense.paymentState ?? "")) return expense.paymentState!;
  if (expense.status === "pending") {
    if (expense.originModule === "purchasing" && expense.originStatus === "pending_audit") return "pending_audit";
    const due = typeof expense.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expense.dueDate)
      ? expense.dueDate : financialDateKey(expense.dueDate);
    const today = financialDateKey(now);
    if (due && today && due <= today) return due < today ? "overdue" : "due_soon";
  }
  return expense.status ?? "pending";
}

export function expenseDisplayAmounts(expense: ExpenseState) {
  const settled = cents(expense.settlementSummary?.principalSettledAmountCents) / 100;
  if (expenseAwaitingConfirmation(expense)) return { open: expenseCashForecastAmount(expense), paid: settled };
  if (expense.status === "paid") return { open: 0, paid: Number(expense.totalValue) || 0 };
  if (expense.status === "partially_paid") return { open: expenseCashForecastAmount(expense), paid: settled };
  if (expense.status === "pending") return { open: expenseCashForecastAmount(expense), paid: settled };
  return { open: 0, paid: 0 };
}

export function showExpenseInOperationalList(expense: ExpenseState, statusFilter: string) {
  return !expense.budgetMigration || statusFilter === "cancelled";
}
