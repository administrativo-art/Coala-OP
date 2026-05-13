import { Timestamp } from "firebase/firestore";

export type AliasMatchType = "contains" | "startsWith" | "endsWith" | "exact";

export type ImportAlias = {
  id: string;
  pattern: string;
  matchType: AliasMatchType;
  caseSensitive: boolean;
  accountPlanId?: string;
  accountPlanName?: string;
  resultCenterId?: string;
  resultCenterName?: string;
  supplier?: string;
  descriptionOverride?: string;
  createdAt: Timestamp;
  createdBy: string;
};

export type ImportedTransaction = {
  tempId: string;
  date: Date;
  amount: number;
  rawDescription: string;
  description: string;
  accountPlanId: string;
  accountPlanName: string;
  resultCenterId: string;
  resultCenterName: string;
  supplier: string;
  matchedAliasId?: string;
  suggestedExpenseId?: string;
  suggestedExpenseDescription?: string;
  suggestedInstallmentNumber?: number;
  suggestedInstallmentValue?: number;
  suggestedConfidence?: "high" | "medium";
  status: "pending" | "confirmed" | "skipped";
  linkedExpenseId?: string;
};

export type ParsedBankEntry = {
  date: Date;
  amount: number;
  description: string;
  fitId?: string;
  type?: string;
};

export type ImportSessionStatus = "open" | "completed" | "discarded";
export type ImportSessionItemStatus = "pending" | "audited" | "ignored" | "completed";
export type ImportSessionExpenseMode = "new" | "existing" | "purchase" | "split";
export type ImportSessionPurchaseLinkMode = "goods" | "freight" | "combined";
export type ImportSessionOrigin = "bank_statement" | "ai_assisted" | "manual" | "other";

export type ImportSessionApportionment = {
  id: string;
  resultCenterId: string;
  resultCenterName: string;
  percentage: number;
};

export type ImportSessionSplitExpense = {
  id: string;
  description: string;
  supplier: string;
  accountPlanId: string;
  accountPlanName: string;
  resultCenterId: string;
  resultCenterName: string;
  competenceDate: string;
  value: number;
};

export type ImportSessionExpenseDraft = {
  mode: ImportSessionExpenseMode;
  linkedExpenseId: string;
  purchaseOrderId: string;
  purchaseLinkMode: ImportSessionPurchaseLinkMode;
  allocatedAmount: number;
  description: string;
  supplier: string;
  accountPlanId: string;
  accountPlanName: string;
  isApportioned: boolean;
  resultCenterId: string;
  resultCenterName: string;
  apportionments: ImportSessionApportionment[];
  splitExpenses: ImportSessionSplitExpense[];
  competenceDate: string;
  notes: string;
};

export type ImportSessionFinancialDraft = {
  movementKind: "standard" | "transfer";
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  paymentMethodId: string;
  paymentMethodLabel: string;
  counterpartyAccountId: string;
  counterpartyAccountName: string;
  counterpartyPaymentMethodId: string;
  counterpartyPaymentMethodLabel: string;
  notes: string;
};

export type ImportSessionItem = {
  id: string;
  origin?: ImportSessionOrigin;
  date: string;
  amount: number;
  rawDescription: string;
  matchedAliasId?: string;
  suggestedExpenseId?: string;
  suggestedExpenseDescription?: string;
  suggestedInstallmentNumber?: number;
  suggestedInstallmentValue?: number;
  suggestedConfidence?: "high" | "medium";
  expenseDraft: ImportSessionExpenseDraft;
  financialDraft: ImportSessionFinancialDraft;
  status: ImportSessionItemStatus;
};

export type ImportSessionSummary = {
  total: number;
  pending: number;
  audited: number;
  ignored: number;
  completed: number;
};

export type ImportSession = {
  id: string;
  origin: ImportSessionOrigin;
  originLabel?: string;
  requestDate?: string;
  displayName: string;
  fileName: string;
  fileType: "ofx" | "csv" | "ai_assisted" | "manual";
  bankProfile?: string;
  statementAccountId: string;
  statementAccountName: string;
  createdBy: string;
  createdByName: string;
  status: ImportSessionStatus;
  items: ImportSessionItem[];
  summary: ImportSessionSummary;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp | null;
};
