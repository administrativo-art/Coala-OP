export type FinancialInboxStatus =
  | "pending_review"
  | "document_pending"
  | "suggestion_available"
  | "under_review"
  | "identified"
  | "linked"
  | "awaiting_authorization"
  | "scheduled"
  | "awaiting_statement"
  | "reconciled"
  | "divergent"
  | "ignored"
  | "archived"
  | "error";

export type FinancialInboxStage =
  | "classify"
  | "link"
  | "pay"
  | "bank"
  | "done"
  | "off"
  | "archive";

export type FinancialInboxRetentionClass =
  | "non_financial"
  | "financial_standard"
  | "tax_or_payroll";

export type FinancialInboxView = "work" | "identified";

export type FinancialInboxResolutionStatus =
  | "pending"
  | "identified"
  | "discarded"
  | "archived";

export type FinancialInboxResolutionKind =
  | "new_charge"
  | "reminder"
  | "duplicate"
  | "forecast_confirmation"
  | "non_financial";

export type FinancialInboxFinancialState =
  | "forecast"
  | "open"
  | "payment_prepared"
  | "scheduled"
  | "reconciled";

export type FinancialInboxResolution = {
  status: FinancialInboxResolutionStatus;
  kind: FinancialInboxResolutionKind | null;
  targetType: "expense" | "forecast" | "inbox_message" | null;
  targetId: string | null;
  installmentNumber: number | null;
  financialState: FinancialInboxFinancialState | null;
  mode: "automatic" | "manual" | null;
  confidence: "high" | "medium" | "low" | null;
  reasons: string[];
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type FinancialInboxStageSummary = {
  count: number;
  amountCents: number;
};

export type FinancialInboxSummary = {
  total: FinancialInboxStageSummary;
  stages: Record<FinancialInboxStage, FinancialInboxStageSummary>;
  generatedAt: string;
};

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
  sourceType?: "attachment" | "link";
  sourceDomain?: string | null;
  sourceUrl?: string | null;
  sourceFingerprint?: string | null;
  extractionStatus?: "not_attempted" | "extracted" | "ocr_extracted" | "needs_ocr" | "empty" | "unsupported" | "failed";
  extractionMethod?: "pdf_text" | "xml_text" | "plain_text" | "ai_document" | null;
  extractionVersion?: string | null;
  extractedTextStoragePath?: string | null;
  extractedAt?: string | null;
  pageCount?: number | null;
  extractedHints?: FinancialInboxDocumentHints | null;
};

export type FinancialInboxServiceType = "mobile" | "landline" | "internet" | "energy" | "water" | "other";

export type FinancialInboxBillingIdentity = {
  supplierTaxId: string | null;
  customerAccount: string | null;
  contractNumber: string | null;
  serviceType: FinancialInboxServiceType | null;
  serviceNumbers: string[];
};

export type FinancialInboxDocumentHints = {
  documentText: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  competence: string | null;
  dueDate: string | null;
  amountCents: number | null;
  barcode: string | null;
  customerAccount: string | null;
  contractNumber: string | null;
  serviceType: FinancialInboxServiceType | null;
  serviceNumbers: string[];
  confidence: "high" | "medium" | "low";
};

export type FinancialInboxClassification = {
  documentType: FinancialInboxDocumentType;
  financeLikely: boolean;
  marketingLikely?: boolean;
  confidence: "high" | "medium" | "low";
  supplierName: string | null;
  competence: string | null;
  dueDate: string | null;
  amountCents: number | null;
  barcode: string | null;
  barcodeMasked: string | null;
  documentReferences?: string[];
  links: string[];
  billingIdentity?: FinancialInboxBillingIdentity | null;
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
  billingIdentity?: FinancialInboxBillingIdentity | null;
  checkedAt: string | null;
};

export type FinancialInboxExistingBankPayment = {
  transactionId: string;
  bankStatus: string | null;
  schedulingStatus: string | null;
  scheduledFor: string | null;
};

export type FinancialInboxExistingSettlement = {
  transactionId: string;
  paidAt: string | null;
};

export type FinancialInboxExpenseSuggestion = {
  status: "not_found" | "suggested" | "ambiguous" | "linked";
  expenseId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  description: string | null;
  supplier: string | null;
  amountCents: number | null;
  dueDate: string | null;
  competence?: string | null;
  billingIdentity?: FinancialInboxBillingIdentity | null;
  reasons: string[];
  paymentState: "paid" | "scheduled" | "needs_scheduling" | null;
  existingBankPayment: FinancialInboxExistingBankPayment | null;
  existingSettlement: FinancialInboxExistingSettlement | null;
  matchedBarcodeMasked?: string | null;
  matchedDocumentReferences?: string[];
  matchStrength?: "document" | "identity" | "attributes" | null;
  alternatives?: FinancialInboxExpenseAlternative[];
};

export type FinancialInboxExpenseAlternative = {
  expenseId: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  description: string;
  supplier: string;
  amountCents: number;
  dueDate: string | null;
  competence?: string | null;
  billingIdentity?: FinancialInboxBillingIdentity | null;
  score: number;
  reasons: string[];
  matchedBarcodeMasked?: string | null;
  matchedDocumentReferences?: string[];
  matchStrength?: "document" | "identity" | "attributes" | null;
};

export type FinancialInboxCreationSuggestion = {
  status: "not_applicable" | "incomplete" | "suggested" | "blocked_by_ambiguity";
  description: string | null;
  supplier: string | null;
  amountCents: number | null;
  dueDate: string | null;
  competence: string | null;
  billingIdentity: FinancialInboxBillingIdentity | null;
  missingFields: string[];
  reasons: string[];
};

export type FinancialInboxLinkResolution = {
  status: "not_checked" | "not_needed" | "resolved" | "requires_login" | "blocked" | "not_found" | "failed";
  checkedAt: string | null;
  sourceDomain: string | null;
  message: string | null;
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
  existingExpenseSuggestion?: FinancialInboxExpenseSuggestion | null;
  creationSuggestion?: FinancialInboxCreationSuggestion | null;
  linkResolution?: FinancialInboxLinkResolution | null;
  existingBankPayment?: FinancialInboxExistingBankPayment | null;
  existingSettlement?: FinancialInboxExistingSettlement | null;
  linkedExpenseInstallmentNumber?: number | null;
  bankState?: FinancialInboxBankState | null;
  statementTransactionId?: string | null;
  resolution?: FinancialInboxResolution | null;
  resolutionContractVersion?: number;
  reviewedAt: string | null;
  reviewedBy: string | null;
  searchTerms?: string[];
  searchIndexVersion?: number;
  searchIndexedAt?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archivedFromStatus?: "ignored" | "identified" | "reconciled" | null;
  retentionClass?: FinancialInboxRetentionClass | null;
  purgeEligibleAt?: string | null;
  retentionPolicyVersion?: number | null;
  createdAt: string;
  updatedAt: string;
};
