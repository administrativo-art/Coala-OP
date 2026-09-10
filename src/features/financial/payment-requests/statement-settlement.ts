import type { BankPaymentRequest } from "./types";

const SETTLEMENT_ELIGIBLE_STATUSES = new Set<BankPaymentRequest["status"]>([
  "submitting",
  "awaiting_bank_approval",
  "scheduled",
  "processing",
  "awaiting_statement",
  "failed",
  "paid",
]);

export function planPaymentRequestStatementSettlement(input: {
  request: BankPaymentRequest;
  expenseId: string;
  bankTransactionId: string;
  cashAmount: number;
  paidAt: string;
  observedAt: string;
}) {
  const { request } = input;
  if (!SETTLEMENT_ELIGIBLE_STATUSES.has(request.status)) return null;
  if (request.expenseId !== input.expenseId) {
    throw new Error("A solicitação bancária pertence a outra despesa.");
  }
  if (Math.abs(Number(request.amount) - input.cashAmount) > 0.01) {
    throw new Error("O valor da solicitação bancária diverge do débito conciliado no extrato.");
  }
  if (request.statementTransactionId && request.statementTransactionId !== input.bankTransactionId) {
    throw new Error("A solicitação bancária já está conciliada com outra movimentação.");
  }

  const beneficiaryDivergence = request.lastError?.code === "BANK_RECONCILIATION_DIVERGENCE"
    && ["beneficiary_source", "receiver"].includes(request.bankReconciliationDivergenceField ?? "");
  const postPaymentCompleted = request.postPaymentProcessingStatus === "completed";
  return {
    patch: {
      status: "paid" as const,
      statementReconciliationStatus: "matched" as const,
      statementTransactionId: input.bankTransactionId,
      paidAt: input.paidAt,
      bankLiquidationObservedAt: request.bankLiquidationObservedAt ?? input.observedAt,
      bankStatusPollFailureCount: 0,
      nextBankStatusCheckAt: null,
      postPaymentProcessingStatus: postPaymentCompleted ? "completed" as const : "pending" as const,
      nextPostPaymentAttemptAt: postPaymentCompleted ? null : input.observedAt,
      ...(beneficiaryDivergence ? {
        beneficiaryVerificationStatus: "divergent" as const,
        beneficiaryVerificationWarning: request.lastError!.safeMessage,
        beneficiaryVerificationObservedAt: request.lastError!.occurredAt,
      } : {}),
      lastError: null,
      updatedAt: input.observedAt,
    },
    event: {
      type: "STATEMENT_PAYMENT_MATCHED",
      at: input.observedAt,
      actorId: "system:bank-reconciliation",
      actorEmail: null,
      statementTransactionId: input.bankTransactionId,
      expenseId: input.expenseId,
      cashAmount: input.cashAmount,
      previousStatus: request.status,
      beneficiaryReviewPreserved: beneficiaryDivergence,
    },
  };
}
