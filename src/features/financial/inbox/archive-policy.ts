import type { FinancialInboxMessage } from "./types";

export type InboxArchiveEvidence = {
  paymentRequestId?: string | null;
  paymentRequestStatus: string | null;
  paymentWorkspaceId?: string | null;
  paymentInterRequestId?: string | null;
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
  expensePaymentRequestId?: string | null;
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
  if (message.status === "payment_failed" || message.bankState === "failed") {
    return { eligible: false, reasonCode: "PAYMENT_FAILED" };
  }
  const resolution = message.resolution;
  const expenseId = message.linkedExpenseId || (resolution?.targetType === "expense"
    ? resolution.targetId : null);
  const reminder = resolution?.kind === "reminder" || resolution?.kind === "duplicate";
  const expenseLinkMatches = Boolean(expenseId)
    && evidence.expenseId === expenseId
    && evidence.expenseWorkspaceId === message.workspaceId
    && (evidence.expenseInboxMessageId === message.id || reminder);
  const paymentId = message.paymentRequestId || evidence.expensePaymentRequestId || null;
  const confirmedHandoff = resolution?.status === "identified"
    && ["scheduled", "reconciled"].includes(resolution.financialState ?? "")
    && ["identified", "scheduled", "awaiting_statement", "reconciled"].includes(message.status)
    && ["scheduled", "awaiting_statement", "reconciled"].includes(message.bankState ?? "")
    && expenseLinkMatches
    && Boolean(paymentId)
    && evidence.paymentRequestId === paymentId
    && evidence.expensePaymentRequestId === paymentId
    && evidence.paymentWorkspaceId === message.workspaceId
    && ["scheduled", "processing", "awaiting_statement", "paid"].includes(evidence.paymentRequestStatus ?? "")
    && Boolean(evidence.paymentInterRequestId)
    && evidence.paymentExpenseId === expenseId
    && ((evidence.paymentSourceType === "financial_inbox"
      && (evidence.paymentSourceId === message.id || reminder))
      || (reminder && evidence.paymentSourceType === "expense_boleto"
        && evidence.paymentSourceId === expenseId));
  if (confirmedHandoff) {
    return { eligible: true, reasonCode: "FINANCIAL_HANDOFF_CONFIRMED" };
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
  if (!expenseId || evidence.expenseId !== expenseId
    || evidence.expenseWorkspaceId !== message.workspaceId
    || (evidence.expenseInboxMessageId !== message.id
      && !(reminder && message.resolution?.targetId === expenseId))) {
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
