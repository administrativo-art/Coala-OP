import type { BeneficiarySnapshot, PaymentBeneficiaryReference } from "../beneficiaries/types";

export type BankPaymentRequestStatus =
  | "draft" | "awaiting_financial_authorization" | "ready_to_submit" | "submitting"
  | "awaiting_bank_approval" | "scheduled" | "processing" | "awaiting_statement" | "paid" | "rejected"
  | "approval_expired" | "failed" | "cancelled";

export type BankPaymentSourceType = "aso" | "generated_receipt" | "termination" | "vacation" | "purchase_order" | "salary" | "expense_complement" | "financial_inbox" | "expense_boleto";
export type LegacyBankPaymentSourceType = Exclude<BankPaymentSourceType, "financial_inbox" | "expense_boleto">;
export type BankPaymentRail = "pix" | "barcode";

export type BarcodePaymentSnapshot = {
  type: "barcode";
  code: string;
  codeHash?: string | null;
  maskedCode: string;
  dueDate: string;
  scheduledFor: string;
  beneficiaryDocument?: string | null;
};

export type PaymentLegalEntitySnapshot = {
  entityId?: string | null;
  legalName: string;
  cnpj: string;
};

type BankPaymentRequestBase = {
  id: string;
  workspaceId?: string;
  sourceId: string;
  expenseId?: string;
  installmentNumber?: number | null;
  legalEntitySnapshot?: PaymentLegalEntitySnapshot;
  amount: number;
  description: string;
  scheduledFor?: string | null;
  status: BankPaymentRequestStatus;
  idempotencyKey: string;
  interRequestId?: string;
  bankInstructionOrigin?: "inter_dda";
  bankStatus?: string;
  bankScheduledFor?: string | null;
  bankNominalAmount?: number | null;
  bankSettlementAmount?: number | null;
  bankLateChargeAmount?: number | null;
  requestedSettlementAmount?: number | null;
  requestedLateChargeAmount?: number | null;
  settlementRevision?: {
    source: "confirmed_document";
    evidenceSource: "manual_document_review";
    sourceAttachmentId: string;
    sourceAttachmentSha256: string;
    barcode: string;
    beneficiaryDocument: string;
    principalAmountCents: number;
    settlementAmountCents: number;
    lateChargeAmountCents: number;
    documentedFor: string;
    authorizedAt: string;
    authorizedBy: string;
    authorizedByEmail?: string | null;
  };
  endToEndId?: string;
  statementReconciliationStatus?: "not_expected" | "expected" | "matched" | "divergent";
  statementTransactionId?: string;
  bankReconciliationDivergenceField?: "amount" | "beneficiary_source" | "receiver" | null;
  proofStoragePath?: string;
  postPaymentProcessingStatus?: "pending" | "completed";
  postPaymentProcessingAttemptCount?: number;
  postPaymentProcessingLeaseId?: string | null;
  postPaymentProcessingLeaseUntil?: string | null;
  nextPostPaymentAttemptAt?: string | null;
  sourceCompletedAt?: string;
  authorizedBy?: string;
  authorizedAt?: string;
  submissionStartedAt?: string;
  submissionAttemptCount?: number;
  submittedAt?: string;
  bankApprovalObservedAt?: string;
  bankSchedulingObservedAt?: string;
  bankLiquidationObservedAt?: string;
  nextBankStatusCheckAt?: string | null;
  bankStatusPollFailureCount?: number;
  beneficiaryVerificationStatus?: "verified" | "divergent" | "unavailable";
  beneficiaryVerificationWarning?: string | null;
  beneficiaryVerificationObservedAt?: string | null;
  paidAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastError?: { code: string; safeMessage: string; occurredAt: string; details?: string | null } | null;
  supersedesPaymentRequestId?: string | null;
  supersededByPaymentRequestId?: string | null;
  duplicateCheck?: {
    checkedAt: string;
    completedAt?: string;
    localRequests: "clear";
    expenseAndObligation: "clear";
    importedStatement: "clear";
    documentFingerprint: "clear";
    sourceIdentity: "clear";
    interSchedulesAndPayments: "pending" | "clear" | "existing_recovered";
    exclusiveLockId: string;
  };
  bankPreflight?: {
    checkedAt: string;
    outcome: "clear" | "existing_recovered";
    bankTransactionCode?: string | null;
  };
  bankCancellation?: {
    status: "pending" | "failed" | "confirmed";
    requestedAt: string;
    requestedBy: string;
    requestedByEmail?: string | null;
    bankTransactionCode: string;
    replacementScheduledFor: string;
    failedAt?: string;
    confirmedAt?: string;
  };
  cancelledAt?: string;
  cancelledBy?: string;
};

export type PixBankPaymentRequest = BankPaymentRequestBase & {
  sourceType: LegacyBankPaymentSourceType;
  paymentRail?: "pix";
  beneficiaryReference: PaymentBeneficiaryReference;
  beneficiarySnapshot: BeneficiarySnapshot;
  barcodeSnapshot?: never;
  status: Exclude<BankPaymentRequestStatus, "awaiting_statement">;
};

export type BarcodeBankPaymentRequest = BankPaymentRequestBase & {
  sourceType: "financial_inbox" | "expense_boleto";
  paymentRail: "barcode";
  beneficiaryReference?: never;
  beneficiarySnapshot?: never;
  barcodeSnapshot: BarcodePaymentSnapshot;
  status: BankPaymentRequestStatus;
};

export type BankPaymentRequest = PixBankPaymentRequest | BarcodeBankPaymentRequest;

export type PaymentActor = { uid: string; email?: string | null; name?: string | null };
