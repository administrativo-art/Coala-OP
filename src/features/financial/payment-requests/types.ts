import type { BeneficiarySnapshot, PaymentBeneficiaryReference } from "../beneficiaries/types";

export type BankPaymentRequestStatus =
  | "draft" | "awaiting_financial_authorization" | "ready_to_submit" | "submitting"
  | "awaiting_bank_approval" | "processing" | "paid" | "rejected"
  | "approval_expired" | "failed" | "cancelled";

export type BankPaymentSourceType = "aso" | "generated_receipt";

export type BankPaymentRequest = {
  id: string;
  sourceType: BankPaymentSourceType;
  sourceId: string;
  expenseId?: string;
  beneficiaryReference: PaymentBeneficiaryReference;
  beneficiarySnapshot: BeneficiarySnapshot;
  amount: number;
  description: string;
  status: BankPaymentRequestStatus;
  idempotencyKey: string;
  interRequestId?: string;
  bankStatus?: string;
  endToEndId?: string;
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

export type PaymentActor = { uid: string; email?: string | null; name?: string | null };
