export type StoneReceivableStatus =
  | "scheduled"
  | "partially_settled"
  | "settled"
  | "overdue"
  | "cancelled"
  | "chargeback";

export type StoneReceivable = {
  id: string;
  workspaceId: string;
  receivableKey: string;
  externalSaleId?: string | null;
  installmentNumber: number;
  installmentCount: number;
  stoneCode: string;
  kioskId: string | null;
  kioskName?: string | null;
  accountId: string;
  grossAmountCents: number;
  mdrAmountCents: number;
  anticipationFeeAmountCents: number;
  adjustmentAmountCents: number;
  netAmountCents: number;
  settledAmountCents: number;
  originalExpectedDate: string;
  currentExpectedDate: string;
  settledAt?: string | null;
  status: StoneReceivableStatus;
  sourceRevision: string;
  sourceHash: string;
};

export type StoneSettlement = {
  id: string;
  workspaceId: string;
  externalSettlementId: string;
  stoneCode: string;
  accountId: string;
  settledAt: string;
  grossAmountCents: number;
  feeAmountCents: number;
  adjustmentAmountCents: number;
  netAmountCents: number;
  receivableKeys: string[];
  providerBankReference?: string | null;
  linkedBankTransactionId?: string | null;
  sourceRevision: string;
  sourceHash: string;
};
