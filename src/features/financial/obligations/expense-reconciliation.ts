import { calculateFinancialObligationSummary, moneyToCents } from "./calculations";
import type { FinancialObligationSummary } from "./types";

export type ExpenseReconciliationSource = {
  id: string;
  status?: unknown;
  paymentState?: unknown;
  provisionType?: unknown;
  provisionedValue?: unknown;
  totalValue?: unknown;
  netPayableValue?: unknown;
  plannedPaymentMethodType?: unknown;
  settlementScope?: unknown;
  settlementSummary?: unknown;
  workspaceId?: unknown;
  type?: unknown;
  originExpenseId?: unknown;
  evidenceSource?: unknown;
  linkedBankTransactionId?: unknown;
  linkedBankTransactionIds?: unknown;
  reconciliationInstallmentNumber?: number;
};

export type ExpenseBankTransaction = {
  id: string;
  amount?: unknown;
  type?: unknown;
  direction?: unknown;
  auditStatus?: unknown;
  reversed?: unknown;
  effectuationStatus?: unknown;
  importedFrom?: unknown;
  importSource?: unknown;
  workspaceId?: unknown;
  expenseId?: unknown;
  linkedExpenseId?: unknown;
  expenseIds?: unknown;
  obligationAllocations?: unknown;
};

export type ExpenseReconciliation = "bank" | "cash" | "reported" | "divergent" | "pending_document" | "unmatched";
type TransactionIndex = {
  byId: Map<string, ExpenseBankTransaction>;
  byExpense: Map<string, Set<string>>;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

type Allocation = { expenseId?: unknown; principalAmount?: unknown };

function allocations(transaction: ExpenseBankTransaction): Allocation[] {
  return Array.isArray(transaction.obligationAllocations)
    ? transaction.obligationAllocations.filter((value): value is Allocation => !!value && typeof value === "object")
    : [];
}

function expenseIds(transaction: ExpenseBankTransaction) {
  return [text(transaction.expenseId), text(transaction.linkedExpenseId), ...strings(transaction.expenseIds),
    ...allocations(transaction).map((allocation) => text(allocation.expenseId))].filter(Boolean);
}

export function expenseLinkedBankIds(expense: ExpenseReconciliationSource) {
  return [...strings(expense.linkedBankTransactionIds), text(expense.linkedBankTransactionId)].filter(Boolean);
}

export function indexExpenseBankTransactions(transactions: readonly ExpenseBankTransaction[]): TransactionIndex {
  const byId = new Map<string, ExpenseBankTransaction>();
  const byExpense = new Map<string, Set<string>>();
  for (const transaction of transactions) {
    byId.set(transaction.id, transaction);
    for (const expenseId of expenseIds(transaction)) {
      const ids = byExpense.get(expenseId) ?? new Set<string>();
      ids.add(transaction.id);
      byExpense.set(expenseId, ids);
    }
  }
  return { byId, byExpense };
}

function storedSummary(expense: ExpenseReconciliationSource): Partial<FinancialObligationSummary> {
  return expense.settlementSummary && typeof expense.settlementSummary === "object"
    ? expense.settlementSummary as Partial<FinancialObligationSummary> : {};
}

function canonicalReconciliation(expense: ExpenseReconciliationSource): ExpenseReconciliation {
  const summary = storedSummary(expense);
  if (summary.reconciliationStatus === "DIVERGENT" || expense.paymentState === "paid_divergent") return "divergent";
  if (summary.reconciliationStatus === "PENDING_DOCUMENT" || expense.paymentState === "payment_found_pending_document") return "pending_document";
  if (expense.status === "paid" && expense.plannedPaymentMethodType === "cash") return "cash";
  if (summary.reconciliationStatus === "MATCHED"
    && (summary.paymentEvidenceStatus === "CONFIRMED" || summary.paymentEvidenceStatus === "MIXED")) return "bank";
  if (summary.paymentEvidenceStatus === "REPORTED" || expense.paymentState === "reported_paid") return "reported";
  return "unmatched";
}

export function expenseNeedsImportedBankEvidence(expense: ExpenseReconciliationSource) {
  if (expense.status !== "paid" || expense.settlementScope === "CARD_LINE" || expense.plannedPaymentMethodType === "credit_card") return false;
  if (expense.reconciliationInstallmentNumber !== undefined && !text(expense.linkedBankTransactionId)) return false;
  const status = canonicalReconciliation(expense);
  return status === "unmatched" || status === "reported";
}

function isResolvedBankDebit(transaction: ExpenseBankTransaction, expense: ExpenseReconciliationSource) {
  return transaction.auditStatus === "resolved"
    && transaction.reversed !== true
    && transaction.effectuationStatus !== "reversed" && transaction.effectuationStatus !== "reopened"
    && ["expense", "expense_payment"].includes(text(transaction.type))
    && (transaction.direction === "out" || (!transaction.direction && Number(transaction.amount) > 0))
    && (transaction.importedFrom === "bank_statement" || transaction.importSource === "inter_api")
    && !(transaction.workspaceId && expense.workspaceId && transaction.workspaceId !== expense.workspaceId);
}

function matchesExpenseAmount(expense: ExpenseReconciliationSource, transaction: ExpenseBankTransaction) {
  const expectedCents = moneyToCents(expense.netPayableValue) || moneyToCents(expense.totalValue);
  const debitCents = Math.abs(moneyToCents(transaction.amount));
  if (expectedCents <= 0 || debitCents <= 0) return false;

  const transactionExpenses = expenseIds(transaction);
  if (expense.type === "encargo" && expense.evidenceSource === "BANK_STATEMENT") {
    const originId = text(expense.originExpenseId);
    // O encargo só compõe o débito em que o título principal foi conciliado.
    return Boolean(originId) && expenseLinkedBankIds(expense).includes(transaction.id)
      && transactionExpenses.includes(originId) && debitCents > expectedCents;
  }
  const candidates = allocations(transaction).filter((allocation) => allocation.expenseId === expense.id);
  if (candidates.length > 0) {
    return candidates.length === 1 && moneyToCents(candidates[0].principalAmount) === expectedCents;
  }
  const exclusivelyLinked = transactionExpenses.length > 0 && transactionExpenses.every((id) => id === expense.id);
  return exclusivelyLinked && debitCents === expectedCents;
}

export function resolveExpenseReconciliation(expense: ExpenseReconciliationSource, index?: TransactionIndex): ExpenseReconciliation {
  const stored = canonicalReconciliation(expense);
  if (!index || !expenseNeedsImportedBankEvidence(expense)) return stored;
  const ids = new Set(expenseLinkedBankIds(expense));
  if (expense.reconciliationInstallmentNumber === undefined) {
    for (const id of index.byExpense.get(expense.id) ?? []) ids.add(id);
  }
  const confirmed = [...ids].map((id) => index.byId.get(id)).filter((transaction): transaction is ExpenseBankTransaction =>
    !!transaction && isResolvedBankDebit(transaction, expense) && matchesExpenseAmount(expense, transaction));
  return confirmed.length === 1 ? "bank" : stored;
}

export function expenseReconciliationSummary(
  expense: ExpenseReconciliationSource,
  reconciliation: ExpenseReconciliation,
): FinancialObligationSummary {
  const summary = storedSummary(expense);
  const fromImportedDebit = reconciliation === "bank" && canonicalReconciliation(expense) !== "bank";
  if (summary.obligationStatus && !fromImportedDebit) return summary as FinancialObligationSummary;

  const actual = expense.provisionType === "forecast" && !fromImportedDebit ? null : moneyToCents(expense.totalValue);
  const net = actual === null ? null : moneyToCents(expense.netPayableValue) || actual;
  const forecast = summary.forecastAmountCents ?? (expense.provisionType === "forecast"
    ? moneyToCents(expense.totalValue)
    : expense.provisionedValue == null ? null : moneyToCents(expense.provisionedValue));
  const paid = expense.status === "paid" ? net ?? 0 : 0;
  return calculateFinancialObligationSummary({
    actualAmountCents: actual,
    forecastAmountCents: forecast,
    settlementAmountCents: net,
    cancelled: expense.status === "cancelled",
    paymentAllocations: paid > 0 ? [{
      principalAmountCents: paid,
      cashAmountCents: paid,
      status: reconciliation === "bank" ? "MATCHED" : "REPORTED",
    }] : [],
  });
}
