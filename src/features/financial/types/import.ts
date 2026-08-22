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
  suggestedAdditionalCharges?: number;
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

export type ImportSessionAccountAllocation = {
  id: string;
  accountPlanId: string;
  accountPlanName: string;
  amount: number;
};

export type ImportSessionPersonAllocation = {
  id: string;
  accountPlanId: string;
  accountPlanName: string;
  employeeId: string;
  employeeName: string;
  analysisType: "employer_cost" | "employee_deduction" | "informational";
  amount: number;
  resultCenterId: string;
  resultCenterName: string;
  payrollDocumentId: string;
  contractReference: string;
  creditorName: string;
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
  dueDate: string;
  value: number;
  percentage: number;
};

export type ImportSessionExpenseDraft = {
  mode: ImportSessionExpenseMode;
  linkedExpenseId: string;
  reportedPaymentId?: string;
  reportedLinkId?: string;
  purchaseOrderId: string;
  purchaseLinkMode: ImportSessionPurchaseLinkMode;
  allocatedAmount: number;
  settlementBaseValue: number;
  settlementInstallmentNumber: number;
  interest: number;
  fine: number;
  discount: number;
  abatement: number;
  chargesAccountPlanId: string;
  chargesAccountPlanName: string;
  description: string;
  supplier: string;
  accountPlanId: string;
  accountPlanName: string;
  hasAccountAllocations: boolean;
  accountAllocations: ImportSessionAccountAllocation[];
  hasPersonAllocations: boolean;
  personAllocations: ImportSessionPersonAllocation[];
  isApportioned: boolean;
  resultCenterId: string;
  resultCenterName: string;
  apportionments: ImportSessionApportionment[];
  splitAllocationMode: "amount" | "percentage";
  splitExpenses: ImportSessionSplitExpense[];
  competenceDate: string;
  dueDate: string;
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

export type ImportSessionItemEffectuation = {
  id: string;
  status: "active" | "reopened";
  transactionIds: string[];
  expenseIds: string[];
  createdExpenseIds: string[];
  purchaseFinancialId?: string | null;
  purchaseGoodsAmount?: number;
  purchaseFreightAmount?: number;
  effectuatedAt?: string;
  effectuatedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenReason?: string;
};

export type ImportSessionItemAuditHistory = {
  action: "audit_confirmed" | "effectuated" | "reopened";
  actorId: string;
  actorName: string;
  at: string;
  revision?: number;
  reason?: string;
  changes?: Array<{
    field: string;
    label: string;
    previousValue: string;
    nextValue: string;
  }>;
};

export type ImportSessionItemAuditSnapshot = {
  values: Record<string, string>;
};

export type ImportSessionItem = {
  id: string;
  origin?: ImportSessionOrigin;
  syncSource?: "inter_api";
  externalTransactionId?: string;
  linkedBankTransactionId?: string;
  bankStatementData?: Record<string, unknown>;
  bankReferences?: string[];
  bankOperationType?: string;
  bankTransactionType?: string;
  date: string;
  amount: number;
  rawDescription: string;
  matchedAliasId?: string;
  suggestedExpenseId?: string;
  suggestedExpenseDescription?: string;
  suggestedInstallmentNumber?: number;
  suggestedInstallmentValue?: number;
  suggestedAdditionalCharges?: number;
  suggestedReportedPaymentId?: string;
  suggestedReportedLinkId?: string;
  suggestedConfidence?: "high" | "medium";
  expenseDraft: ImportSessionExpenseDraft;
  financialDraft: ImportSessionFinancialDraft;
  status: ImportSessionItemStatus;
  effectuation?: ImportSessionItemEffectuation;
  auditHistory?: ImportSessionItemAuditHistory[];
  auditSnapshot?: ImportSessionItemAuditSnapshot;
  auditRevision?: number;
};

export type ImportSessionSummary = {
  total: number;
  pending: number;
  audited: number;
  ignored: number;
  completed: number;
};

export type ImportStatementClosure = {
  itemCount: number;
  completedCount: number;
  ignoredCount: number;
  entries: number;
  exits: number;
  balance: number;
  completedAmount: number;
  ignoredAmount: number;
};

export type ImportSession = {
  id: string;
  origin: ImportSessionOrigin;
  syncSource?: "inter_api";
  syncKey?: string;
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
  closure?: ImportStatementClosure;
  closureHash?: string;
  closedAt?: Timestamp | null;
  closedBy?: string;
  statementOutdated?: boolean;
};
