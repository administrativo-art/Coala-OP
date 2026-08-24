export type FinancialInboxStatus =
  | "pending_review"
  | "document_pending"
  | "suggestion_available"
  | "under_review"
  | "linked"
  | "awaiting_authorization"
  | "scheduled"
  | "awaiting_statement"
  | "reconciled"
  | "divergent"
  | "ignored"
  | "error";

export type FinancialInboxDocumentType =
  | "fgts"
  | "inss_darf"
  | "accounting_fee"
  | "tax"
  | "utility_bill"
  | "charge"
  | "other";

export type FinancialInboxAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentDisposition: string | null;
  storagePath: string | null;
  sha256: string | null;
  archiveStatus: "stored" | "skipped_inline" | "skipped_unsafe" | "skipped_size" | "failed";
};

export type FinancialInboxClassification = {
  documentType: FinancialInboxDocumentType;
  financeLikely: boolean;
  confidence: "high" | "medium" | "low";
  supplierName: string | null;
  competence: string | null;
  dueDate: string | null;
  amountCents: number | null;
  barcode: string | null;
  barcodeMasked: string | null;
  links: string[];
};

export type FinancialInboxProvisionSuggestion = {
  status: "not_checked" | "not_found" | "suggested" | "ambiguous" | "linked";
  provisionExpenseId: string | null;
  confidence: "high" | "medium" | "low" | null;
  score: number | null;
  reasons: string[];
  description: string | null;
  supplier: string | null;
  competence: string | null;
  dueDate: string | null;
  provisionedAmountCents: number | null;
  checkedAt: string | null;
};

export type FinancialInboxBankState =
  | "not_prepared"
  | "awaiting_authorization"
  | "ready_to_submit"
  | "submitted"
  | "awaiting_bank_approval"
  | "scheduled"
  | "processing"
  | "awaiting_statement"
  | "reconciled"
  | "divergent"
  | "failed"
  | "cancelled";

export type FinancialInboxMessage = {
  id: string;
  workspaceId: string;
  provider: "resend";
  providerEmailId: string;
  providerEventId: string;
  messageId: string | null;
  status: FinancialInboxStatus;
  from: string;
  fromAddress: string | null;
  senderDomain: string | null;
  to: string[];
  originalRecipients: string[];
  subject: string;
  receivedAt: string;
  textPreview: string;
  textContent: string;
  classification: FinancialInboxClassification;
  attachments: FinancialInboxAttachment[];
  rawStoragePath: string | null;
  rawSha256: string | null;
  archiveWarnings: string[];
  linkedExpenseId: string | null;
  linkedProvisionId?: string | null;
  obligationId?: string | null;
  paymentRequestId?: string | null;
  provisionSuggestion?: FinancialInboxProvisionSuggestion | null;
  bankState?: FinancialInboxBankState | null;
  statementTransactionId?: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
