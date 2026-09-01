import type { BeneficiarySnapshot, PaymentBeneficiaryReference } from "../beneficiaries/types";

export type BankPaymentRequestStatus =
  | "draft" | "awaiting_financial_authorization" | "ready_to_submit" | "submitting"
  | "awaiting_bank_approval" | "scheduled" | "processing" | "awaiting_statement" | "paid" | "rejected"
  | "approval_expired" | "failed" | "cancelled";

export type BankPaymentSourceType = "aso" | "generated_receipt" | "termination" | "vacation" | "purchase_order" | "financial_inbox";
export type LegacyBankPaymentSourceType = Exclude<BankPaymentSourceType, "financial_inbox">;
export type BankPaymentRail = "pix" | "barcode";

export type BarcodePaymentSnapshot = {
  type: "barcode";
  code: string;
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
  sourceId: string;
  expenseId?: string;
  legalEntitySnapshot?: PaymentLegalEntitySnapshot;
  amount: number;
  description: string;
  scheduledFor?: string | null;
  status: BankPaymentRequestStatus;
  idempotencyKey: string;
  interRequestId?: string;
  bankStatus?: string;
  endToEndId?: string;
  statementReconciliationStatus?: "not_expected" | "expected" | "matched" | "divergent";
  statementTransactionId?: string;
  proofStoragePath?: string;
  sourceCompletedAt?: string;
  authorizedBy?: string;
  authorizedAt?: string;
  submittedAt?: string;
  paidAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastError?: { code: string; safeMessage: string; occurredAt: string };
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
  sourceType: "financial_inbox";
  paymentRail: "barcode";
  beneficiaryReference?: never;
  beneficiarySnapshot?: never;
  barcodeSnapshot: BarcodePaymentSnapshot;
  status: BankPaymentRequestStatus;
};

export type BankPaymentRequest = PixBankPaymentRequest | BarcodeBankPaymentRequest;

export type PaymentActor = { uid: string; email?: string | null; name?: string | null };
