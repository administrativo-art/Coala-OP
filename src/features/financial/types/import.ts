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
