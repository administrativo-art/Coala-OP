export type ReconciliationSalesChannel = "pix" | "debit_card" | "credit_card";

export type ReconciliationSaleStatus =
  | "approved"
  | "pending"
  | "partial_cancellation"
  | "cancelled"
  | "refunded"
  | "chargeback";

export type SalesSourceIdentifiers = {
  providerTransactionId?: string | null;
  /** Stable Stone Pix event identifier; the PDV exposes the same value as its NSU. */
  providerEventId?: string | null;
  nsu?: string | null;
  authorizationCode?: string | null;
  terminalId?: string | null;
  merchantOrderId?: string | null;
};

export type PdvSaleAdjustment = {
  type: "item_cancellation";
  originalAmountCents: number;
  cancelledAmountCents: number;
  finalAmountCents: number;
  lastCancellationAt: string | null;
  finalizedAt: string;
  finalizedAfterCancellation: boolean;
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
  adjustment?: PdvSaleAdjustment;
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
  | "provider_event_id"
  | "nsu_authorization_terminal"
  | "merchant_order"
  | "unique_amount_time"
  | "daily_amount_multiset"
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
  reviewStatus: "auto_checked" | "attention_required";
};
