import type { FinancialInboxMessage } from "./types";

export type InboxArchiveEvidence = {
  paymentRequestStatus: string | null;
  paymentStatementStatus: string | null;
  paymentSourceType?: string | null;
  paymentSourceId?: string | null;
  paymentExpenseId?: string | null;
  obligationStatus: string | null;
  obligationSourceId?: string | null;
  expenseId?: string | null;
  expenseWorkspaceId?: string | null;
  expenseStatus?: string | null;
  expenseInboxMessageId?: string | null;
  expenseObligationId?: string | null;
  expenseReconciliationStatus?: string | null;
};

export function financialInboxArchiveEligibility(
  message: FinancialInboxMessage,
  evidence: InboxArchiveEvidence,
): { eligible: boolean; reasonCode: string } {
  if (message.status === "archived") return { eligible: true, reasonCode: "ALREADY_ARCHIVED" };
  if (message.status === "ignored") {
    return !message.linkedExpenseId && !message.linkedProvisionId && !message.obligationId
      && !message.paymentRequestId && !message.existingBankPayment && !message.statementTransactionId
      && (!message.bankState || ["not_prepared", "cancelled"].includes(message.bankState))
      ? { eligible: true, reasonCode: "NOISE_OR_DISCARD_REVIEWED" }
      : { eligible: false, reasonCode: "IGNORED_WITH_FINANCIAL_LINK" };
  }
  if (message.status !== "reconciled" && (message.status !== "identified"
    || message.resolution?.status !== "identified"
    || message.resolution.financialState !== "reconciled")) {
    return { eligible: false, reasonCode: "NOT_TERMINAL" };
  }
  if (message.bankState && message.bankState !== "reconciled") {
    return { eligible: false, reasonCode: "BANK_IN_PROGRESS" };
  }
  if (message.existingBankPayment && !message.existingSettlement) {
    return { eligible: false, reasonCode: "BANK_IN_PROGRESS" };
  }
  const expenseId = message.linkedExpenseId || (message.resolution?.targetType === "expense"
    ? message.resolution.targetId : null);
  if (!expenseId || evidence.expenseId !== expenseId
    || evidence.expenseWorkspaceId !== message.workspaceId
    || (evidence.expenseInboxMessageId !== message.id
      && !(message.resolution?.kind === "reminder" && message.resolution.targetId === expenseId))) {
    return { eligible: false, reasonCode: "EXPENSE_LINK_CONFLICT" };
  }
  if (evidence.expenseStatus !== "paid" || evidence.expenseReconciliationStatus !== "MATCHED") {
    return { eligible: false, reasonCode: "EXPENSE_NOT_SETTLED" };
  }
  if (message.obligationId && evidence.expenseObligationId !== message.obligationId) {
    return { eligible: false, reasonCode: "EXPENSE_LINK_CONFLICT" };
  }
  if (message.paymentRequestId && (evidence.paymentRequestStatus !== "paid"
    || evidence.paymentStatementStatus !== "matched"
    || evidence.paymentSourceType !== "financial_inbox"
    || evidence.paymentSourceId !== message.id
    || evidence.paymentExpenseId !== message.linkedExpenseId)) {
    return { eligible: false, reasonCode: "PAYMENT_IN_PROGRESS" };
  }
  if (message.obligationId && (evidence.obligationStatus !== "PAID"
    || !message.linkedExpenseId || evidence.obligationSourceId !== message.linkedExpenseId)) {
    return { eligible: false, reasonCode: "OBLIGATION_IN_PROGRESS" };
  }
  return { eligible: true, reasonCode: "FINANCIAL_TREATMENT_COMPLETE" };
}
