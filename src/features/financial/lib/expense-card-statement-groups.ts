import {
  buildCardStatementLinesFromAllocations,
  cardDateFromUnknown,
  cardExpenseAuditIssues,
  cardExpenseIsActiveStatementLine,
  cardStatementLineAuditStatus,
  type CardExpenseEntry,
  type CardStatementAllocation,
  type CardStatementLineAuditStatus,
} from "./card-invoices";

type GroupableCardExpense = CardExpenseEntry & {
  id: string;
  status?: unknown;
  totalValue?: unknown;
};

export type ExpenseCardStatementDocument = {
  id: string;
  key?: unknown;
  monthKey?: unknown;
  accountId?: unknown;
  paymentMethodId?: unknown;
  paymentMethodLabel?: unknown;
  officialTotal?: unknown;
  creditTotal?: unknown;
  dueDate?: unknown;
  status?: unknown;
  allocations?: CardStatementAllocation[];
};

export type ExpenseCardStatementLine<T extends GroupableCardExpense> = {
  lineId: string;
  expense: T;
  amount: number;
  installmentNumber: number | null;
  auditStatus: CardStatementLineAuditStatus;
};

export type ExpenseCardStatementGroup<T extends GroupableCardExpense> = {
  id: string;
  key: string;
  statementId: string;
  monthKey: string;
  accountId: string;
  paymentMethodId: string;
  title: string;
  paymentMethodLabel: string;
  dueDate: Date | null;
  totalValue: number;
  creditTotal: number;
  status: "pending" | "partially_paid" | "paid";
  official: boolean;
  lineCount: number;
  lines: ExpenseCardStatementLine<T>[];
  expenses: T[];
  unmatchedExpenses: T[];
  auditCounts: Record<CardStatementLineAuditStatus, number>;
};

export type ExpenseCardStatementListEntry<T extends GroupableCardExpense> =
  | { kind: "expense"; expense: T }
  | { kind: "card_statement"; statement: ExpenseCardStatementGroup<T> };

type StatementIdentity = {
  key: string;
  monthKey: string;
  statementId: string;
};

type GroupOptions<T extends GroupableCardExpense> = {
  statements?: ExpenseCardStatementDocument[];
  allExpenses?: T[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: unknown) {
  return Number((Number(value) || 0).toFixed(2));
}

export function cardStatementDocumentId(key: string) {
  return key.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function statementIdentity(expense: GroupableCardExpense): StatementIdentity | null {
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
  if (expense.cardStatementAuditDisposition === "waived_before_dre_start") return "historical";
  return cardExpenseAuditIssues(expense).length === 0 ? "audited" : "pending";
}

function financialStatus(expenses: GroupableCardExpense[]) {
  const paidCount = expenses.filter((expense) => expense.status === "paid").length;
  if (expenses.length > 0 && paidCount === expenses.length) return "paid" as const;
  if (paidCount > 0 || expenses.some((expense) => expense.status === "partially_paid")) {
    return "partially_paid" as const;
  }
  return "pending" as const;
}

function officialFinancialStatus(status: unknown) {
  return status === "paid" ? "paid" as const : "pending" as const;
}

function emptyAuditCounts() {
  return { pending: 0, audited: 0, historical: 0, reconciled: 0 };
}

function statementMap(statements: ExpenseCardStatementDocument[]) {
  const byIdentity = new Map<string, ExpenseCardStatementDocument>();
  statements.forEach((statement) => {
    const key = text(statement.key);
    const id = text(statement.id);
    if (key) byIdentity.set(key, statement);
    if (id) byIdentity.set(id, statement);
  });
  return byIdentity;
}

function installmentLines<T extends GroupableCardExpense>(
  expense: T,
  identity: StatementIdentity,
): ExpenseCardStatementLine<T>[] {
  const installments = Array.isArray(expense.installments) ? expense.installments : [];
  const matching = installments
    .map((installment, index) => ({ installment, index }))
    .filter(({ installment }) => {
      const monthKey = text(installment.cardStatementMonthKey);
      const key = text(installment.cardStatementKey);
      return installment.cardStatementRevisionStatus !== "removed"
        && (key === identity.key || (!key && monthKey === identity.monthKey));
    });
  if (matching.length === 0) {
    return [{
      lineId: expense.id,
      expense,
      amount: money(expense.totalValue),
      installmentNumber: null,
      auditStatus: expenseAuditStatus(expense),
    }];
  }
  return matching.map(({ installment, index }) => ({
    lineId: `${expense.id}:installment:${Number(installment.number) || index + 1}`,
    expense,
    amount: money(installment.value),
    installmentNumber: Number(installment.number) || index + 1,
    auditStatus: installment.cardReconciliationStatus === "reconciled"
      ? "reconciled"
      : expenseAuditStatus(expense),
  }));
}

function finishProjectedGroup<T extends GroupableCardExpense>(
  identity: StatementIdentity,
  expenses: T[],
) {
  const activeExpenses = expenses.filter(cardExpenseIsActiveStatementLine);
  const paymentMethodLabel = text(activeExpenses[0]?.plannedPaymentMethodLabel) || "Cartão de crédito";
  const dueDates = activeExpenses
    .map((expense) => cardDateFromUnknown(expense.dueDate))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  const lines = activeExpenses.flatMap((expense) => installmentLines(expense, identity));
  const auditCounts = emptyAuditCounts();
  lines.forEach((line) => { auditCounts[line.auditStatus] += 1; });

  return {
    id: identity.statementId,
    key: identity.key,
    statementId: identity.statementId,
    monthKey: identity.monthKey,
    accountId: text(activeExpenses[0]?.plannedBankAccountId),
    paymentMethodId: text(activeExpenses[0]?.plannedPaymentMethodId),
    title: statementTitle(paymentMethodLabel, identity.monthKey),
    paymentMethodLabel,
    dueDate: dueDates.at(-1) ?? null,
    totalValue: money(lines.reduce((total, line) => total + line.amount, 0)),
    creditTotal: 0,
    status: financialStatus(activeExpenses),
    official: false,
    lineCount: lines.length,
    lines,
    expenses: activeExpenses,
    unmatchedExpenses: [],
    auditCounts,
  } satisfies ExpenseCardStatementGroup<T>;
}

function finishOfficialGroup<T extends GroupableCardExpense>(
  identity: StatementIdentity,
  statement: ExpenseCardStatementDocument,
  allExpenses: T[],
) {
  const allocations = Array.isArray(statement.allocations) ? statement.allocations : [];
  const allExpenseById = new Map(allExpenses.map((expense) => [expense.id, expense]));
  const allocatedExpenseIds = new Set(allocations.map((allocation) => allocation.expenseId));
  const officialCardLines = buildCardStatementLinesFromAllocations(allocations, allExpenses);
  const lines = officialCardLines.map((line) => ({
    lineId: line.lineId,
    expense: (allExpenseById.get(line.expense.id) ?? line.expense) as T,
    amount: money(line.value),
    installmentNumber: line.installmentNumber ?? null,
    auditStatus: cardStatementLineAuditStatus(line),
  }));
  const expenses = [...new Map(lines.map((line) => [line.expense.id, line.expense])).values()];
  const candidates = allExpenses.filter((expense) => statementIdentity(expense)?.key === identity.key);
  const unmatchedExpenses = candidates.filter((expense) => !allocatedExpenseIds.has(expense.id));
  const paymentMethodLabel = text(statement.paymentMethodLabel)
    || text(expenses[0]?.plannedPaymentMethodLabel)
    || "Cartão de crédito";
  const auditCounts = emptyAuditCounts();
  lines.forEach((line) => { auditCounts[line.auditStatus] += 1; });
  const allocationTotal = money(lines.reduce((total, line) => total + line.amount, 0));
  const officialTotal = Number(statement.officialTotal);
  const hasOfficialTotal = statement.officialTotal !== null
    && statement.officialTotal !== undefined
    && Number.isFinite(officialTotal);

  return {
    id: text(statement.id) || identity.statementId,
    key: text(statement.key) || identity.key,
    statementId: text(statement.id) || identity.statementId,
    monthKey: text(statement.monthKey) || identity.monthKey,
    accountId: text(statement.accountId) || text(expenses[0]?.plannedBankAccountId),
    paymentMethodId: text(statement.paymentMethodId) || text(expenses[0]?.plannedPaymentMethodId),
    title: statementTitle(paymentMethodLabel, text(statement.monthKey) || identity.monthKey),
    paymentMethodLabel,
    dueDate: cardDateFromUnknown(statement.dueDate),
    totalValue: hasOfficialTotal ? money(officialTotal) : allocationTotal,
    creditTotal: money(Math.max(0, Number(statement.creditTotal) || 0)),
    status: officialFinancialStatus(statement.status),
    official: true,
    lineCount: allocations.length,
    lines,
    expenses,
    unmatchedExpenses,
    auditCounts,
  } satisfies ExpenseCardStatementGroup<T>;
}

export function groupExpensesByCardStatement<T extends GroupableCardExpense>(
  expenses: T[],
  options: GroupOptions<T> = {},
): ExpenseCardStatementListEntry<T>[] {
  const statements = statementMap(options.statements || []);
  const allExpenses = options.allExpenses || expenses;
  const grouped = new Map<string, { identity: StatementIdentity; expenses: T[] }>();
  const ordered: Array<{ kind: "expense"; expense: T } | { kind: "statement_key"; key: string }> = [];

  expenses.forEach((expense) => {
    const identity = statementIdentity(expense);
    const officialStatement = identity
      ? statements.get(identity.key) ?? statements.get(identity.statementId)
      : null;
    if (!identity || (!officialStatement && !cardExpenseIsActiveStatementLine(expense))) {
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
    const officialStatement = statements.get(group.identity.key) ?? statements.get(group.identity.statementId);
    return {
      kind: "card_statement",
      statement: officialStatement
        ? finishOfficialGroup(group.identity, officialStatement, allExpenses)
        : finishProjectedGroup(group.identity, group.expenses),
    };
  });
}
