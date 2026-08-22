import {
  cardDateFromUnknown,
  cardExpenseAuditIssues,
  type CardExpenseEntry,
  type CardStatementLineAuditStatus,
} from "./card-invoices";

type GroupableCardExpense = CardExpenseEntry & {
  id: string;
  status?: unknown;
  totalValue?: unknown;
};

export type ExpenseCardStatementGroup<T extends GroupableCardExpense> = {
  id: string;
  key: string;
  statementId: string;
  monthKey: string;
  title: string;
  paymentMethodLabel: string;
  dueDate: Date | null;
  totalValue: number;
  status: "pending" | "partially_paid" | "paid";
  expenses: T[];
  auditCounts: Record<CardStatementLineAuditStatus, number>;
};

export type ExpenseCardStatementListEntry<T extends GroupableCardExpense> =
  | { kind: "expense"; expense: T }
  | { kind: "card_statement"; statement: ExpenseCardStatementGroup<T> };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function cardStatementDocumentId(key: string) {
  return key.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function statementIdentity(expense: GroupableCardExpense) {
  if (expense.plannedPaymentMethodType !== "credit_card") return null;
  const monthFromField = text(expense.cardStatementMonthKey);
  const storedKey = text(expense.cardStatementKey);
  const keyParts = storedKey.split(":");
  const monthFromKey = keyParts.at(-1) || "";
  const monthKey = /^\d{4}-\d{2}$/.test(monthFromField)
    ? monthFromField
    : /^\d{4}-\d{2}$/.test(monthFromKey)
      ? monthFromKey
      : "";
  if (!monthKey) return null;

  const accountId = text(expense.plannedBankAccountId);
  const methodId = text(expense.plannedPaymentMethodId);
  const key = storedKey || (accountId && methodId ? `${accountId}:${methodId}:${monthKey}` : "");
  if (!key) return null;

  return {
    key,
    monthKey,
    statementId: text(expense.cardStatementId) || cardStatementDocumentId(key),
  };
}

function statementTitle(paymentMethodLabel: string, monthKey: string) {
  const [year, month] = monthKey.split("-");
  const cardLabel = paymentMethodLabel
    .replace(/^cartão\s+(?:de\s+)?crédito\s*/iu, "")
    .replace(/\s*[-–—]\s*(?=\d{4}$)/u, " ")
    .trim() || "Cartão de crédito";
  return `Fatura ${cardLabel} — ${month}/${year}`;
}

function expenseAuditStatus(expense: GroupableCardExpense): CardStatementLineAuditStatus {
  if (expense.cardReconciliationStatus === "reconciled") return "reconciled";
  return cardExpenseAuditIssues(expense).length === 0 ? "audited" : "pending";
}

function financialStatus(expenses: GroupableCardExpense[]) {
  const paidCount = expenses.filter((expense) => expense.status === "paid").length;
  if (paidCount === expenses.length) return "paid" as const;
  if (paidCount > 0 || expenses.some((expense) => expense.status === "partially_paid")) {
    return "partially_paid" as const;
  }
  return "pending" as const;
}

function finishGroup<T extends GroupableCardExpense>(
  identity: ReturnType<typeof statementIdentity> & {},
  expenses: T[],
) {
  const paymentMethodLabel = text(expenses[0]?.plannedPaymentMethodLabel) || "Cartão de crédito";
  const dueDates = expenses
    .map((expense) => cardDateFromUnknown(expense.dueDate))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  const auditCounts = { pending: 0, audited: 0, reconciled: 0 };
  expenses.forEach((expense) => {
    auditCounts[expenseAuditStatus(expense)] += 1;
  });

  return {
    id: identity.statementId,
    key: identity.key,
    statementId: identity.statementId,
    monthKey: identity.monthKey,
    title: statementTitle(paymentMethodLabel, identity.monthKey),
    paymentMethodLabel,
    dueDate: dueDates.at(-1) ?? null,
    totalValue: Number(expenses.reduce((total, expense) => total + (Number(expense.totalValue) || 0), 0).toFixed(2)),
    status: financialStatus(expenses),
    expenses,
    auditCounts,
  } satisfies ExpenseCardStatementGroup<T>;
}

export function groupExpensesByCardStatement<T extends GroupableCardExpense>(
  expenses: T[],
): ExpenseCardStatementListEntry<T>[] {
  const grouped = new Map<string, { identity: NonNullable<ReturnType<typeof statementIdentity>>; expenses: T[] }>();
  const ordered: Array<{ kind: "expense"; expense: T } | { kind: "statement_key"; key: string }> = [];

  expenses.forEach((expense) => {
    const identity = statementIdentity(expense);
    if (!identity) {
      ordered.push({ kind: "expense", expense });
      return;
    }
    const current = grouped.get(identity.key);
    if (current) {
      current.expenses.push(expense);
      return;
    }
    grouped.set(identity.key, { identity, expenses: [expense] });
    ordered.push({ kind: "statement_key", key: identity.key });
  });

  return ordered.map((entry) => {
    if (entry.kind === "expense") return entry;
    const group = grouped.get(entry.key)!;
    return { kind: "card_statement", statement: finishGroup(group.identity, group.expenses) };
  });
}
