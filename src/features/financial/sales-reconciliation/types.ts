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

export type PdvPaymentFact = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName?: string | null;
  couponId: string;
  paymentIndex: number;
  soldAt: string;
  businessDate: string;
  period: string;
  channel: ReconciliationSalesChannel;
  grossAmountCents: number;
  status: ReconciliationSaleStatus;
  operatorId?: string | null;
  identifiers: SalesSourceIdentifiers;
  sourceHash: string;
  sourceRevision: string;
};

export type StoneSaleTransaction = {
  id: string;
  workspaceId: string;
  externalTransactionId: string;
  stoneCode: string;
  kioskId: string | null;
  kioskName?: string | null;
  soldAt: string;
  businessDate: string;
  period: string;
  channel: ReconciliationSalesChannel;
  grossAmountCents: number;
  installmentCount: number;
  brand?: string | null;
  status: ReconciliationSaleStatus;
  identifiers: SalesSourceIdentifiers;
  sourceHash: string;
  sourceRevision: string;
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
  reviewStatus: "matched_auto" | "pending_review";
};

export type SalesReconciliationPeriodStatus =
  | "open"
  | "partial"
  | "ready"
  | "closed"
  | "reopened"
  | "stale";

export type SalesReconciliationReviewStatus =
  | "matched_auto"
  | "pending_review"
  | "resolved"
  | "ignored";

export type PersistedSalesReconciliationCase = Omit<SuggestedSalesReconciliationCase, "reviewStatus"> & {
  id: string;
  identityId: string;
  projectionId: string;
  sourceFingerprint: string;
  suggestedReviewStatus: SuggestedSalesReconciliationCase["reviewStatus"];
  reviewStatus: SalesReconciliationReviewStatus;
  decision?: (SalesReconciliationDecision & {
    actorId: string;
    actorName: string;
    decidedAt: unknown;
  }) | null;
};

export type RevenueReconciliationPeriodSummary = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName?: string | null;
  period: string;
  status: SalesReconciliationPeriodStatus;
  activeProjectionId: string;
  pdvFactCount: number;
  stoneSaleCount: number;
  caseCount: number;
  decidedCaseCount: number;
  pendingCaseCount: number;
  coveragePercent: number;
  pdvGrossAmountCents: number;
  stoneGrossAmountCents: number;
  differenceAmountCents: number;
  reconciledRevenueCents: number;
  sourceFingerprint: string;
};

export type SalesReconciliationDecision = {
  action: "confirm" | "classify" | "ignore";
  classification?:
    | "valid_sale"
    | "stone_only_sale"
    | "invalid_pdv_payment"
    | "other_acquirer"
    | "wrong_unit"
    | "timing_difference"
    | "cancelled_or_refunded";
  targetKioskId?: string;
  reason: string;
};
