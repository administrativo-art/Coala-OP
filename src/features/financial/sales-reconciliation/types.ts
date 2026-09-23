export type ReconciliationSalesChannel = "pix" | "debit_card" | "credit_card";

export type ReconciliationSaleStatus =
  | "approved"
  | "pending"
  | "cancelled"
  | "refunded"
  | "chargeback";

export type SalesSourceIdentifiers = {
  providerTransactionId?: string | null;
  nsu?: string | null;
  authorizationCode?: string | null;
  terminalId?: string | null;
  merchantOrderId?: string | null;
};

export type SalesMatchFact = {
  id: string;
  source: "pdv" | "stone";
  workspaceId: string;
  kioskId: string | null;
  businessDate: string;
  soldAt: string;
  channel: ReconciliationSalesChannel;
  grossAmountCents: number;
  status: ReconciliationSaleStatus;
  couponId?: string | null;
  identifiers: SalesSourceIdentifiers;
};

export type SalesReconciliationCaseKind =
  | "matched"
  | "pdv_only"
  | "stone_only"
  | "amount_mismatch"
  | "status_mismatch"
  | "unit_mismatch"
  | "unit_unmapped"
  | "ambiguous";

export type SalesReconciliationMatchBasis =
  | "provider_transaction_id"
  | "nsu_authorization_terminal"
  | "merchant_order"
  | "unique_amount_time"
  | "candidate_group"
  | "unmatched";

export type SuggestedSalesReconciliationCase = {
  deterministicKey: string;
  workspaceId: string;
  kioskId: string | null;
  kioskIds: string[];
  period: string;
  businessDate: string;
  channel: ReconciliationSalesChannel;
  pdvFactIds: string[];
  stoneSaleIds: string[];
  pdvGrossAmountCents: number;
  stoneGrossAmountCents: number;
  differenceAmountCents: number;
  kind: SalesReconciliationCaseKind;
  matchBasis: SalesReconciliationMatchBasis;
  confidence: "high" | "medium" | "none";
  reviewStatus: "pending_review";
};
