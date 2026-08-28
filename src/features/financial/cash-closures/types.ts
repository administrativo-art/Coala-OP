import type { CashClosureChannel } from "./channel-normalization";

export type { CashClosureChannel };

export type CashClosureStatus =
  | "not_synced"
  | "draft"
  | "pending_review"
  | "approved"
  | "reopened"
  | "sync_error";

export type CashClosureLineStatus = "pending" | "matched" | "divergent" | "ignored";

export const CASH_CLOSURE_CHANNELS = [
  "cash",
  "pix",
  "debit_card",
  "credit_card",
  "voucher",
  "signed_account",
  "other",
] as const satisfies readonly CashClosureChannel[];

export type CashClosureChannelTotals = Record<CashClosureChannel, number>;

export type CashClosureSource = {
  provider: "pdvlegal";
  endpoint: "cupom/get";
  couponCount: number;
  validCouponCount: number;
  ignoredCancelledCouponCount: number;
  estornadoCouponCount: number;
  itemCount: number;
  paymentRowCount: number;
  rawPaymentNames: string[];
  unknownPaymentNames: string[];
  integrityWarnings: string[];
};

export type CashClosureLineMetadata = {
  grossCashCents?: number;
  changeCents?: number;
  paymentRowCount?: number;
  firstCouponAt?: string;
  lastCouponAt?: string;
};

export type BuiltCashClosureLine = {
  operatorId: string;
  operatorName: string;
  channel: CashClosureChannel;
  channelLabel: string;
  expectedAmountCents: number;
  reportedAmountCents: number | null;
  reportedDifferenceAmountCents: number | null;
  countedAmountCents: number | null;
  differenceAmountCents: number | null;
  status: CashClosureLineStatus;
  rawPaymentNames: string[];
  metadata: CashClosureLineMetadata;
  note: string | null;
};

/**
 * Saída do motor de fechamento (Fase 1, sem persistência). Cobre apenas o
 * lado "esperado" (PDV). Pix e cartões também nascem informados e conferidos
 * pelo próprio PDV; dinheiro e demais canais aguardam a contagem manual.
 */
export type BuiltCashClosure = {
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  date: string;
  year: number;
  month: number;
  day: number;
  status: "draft";
  expectedTotalCents: number;
  expectedByChannelCents: Partial<Record<CashClosureChannel, number>>;
  operatorCount: number;
  lines: BuiltCashClosureLine[];
  source: CashClosureSource;
};

export type CashClosureBuildContext = {
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  /** Dia de fechamento alvo, formato yyyy-MM-dd, em America/Belem. */
  date: string;
  /** `usuariorecebimento_id` do PDV → nome legível, de `fetchPdvLegalUsers()`. */
  operatorNameById?: Record<string, string>;
};

export type CashClosureDepositStatus =
  | "not_eligible"
  | "not_allocated"
  | "allocated"
  | "issued"
  | "paid"
  | "adjusted";

export type CashClosureDepositState = {
  eligibleCents: number;
  batchId: string | null;
  batchItemId: string | null;
  status: CashClosureDepositStatus;
  manualSplitRequired: boolean;
  manualSplitBatchIds?: string[];
  adjustmentId?: string | null;
  allocationReason: "amount_exceeds_limit" | "pending_allocator" | null;
  pendingSince: string | null;
};

export type CashClosure = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  date: string;
  year: number;
  month: number;
  day: number;
  status: CashClosureStatus;
  expectedTotalCents: number;
  reportedTotalCents: number;
  countedTotalCents: number;
  reportedDifferenceTotalCents: number;
  differenceTotalCents: number;
  expectedCashCents: number;
  reportedCashCents: number;
  countedCashCents: number;
  cashDepositEligibleCents: number;
  expectedByChannelCents: CashClosureChannelTotals;
  reportedByChannelCents: CashClosureChannelTotals;
  countedByChannelCents: CashClosureChannelTotals;
  reportedDifferenceByChannelCents: CashClosureChannelTotals;
  differenceByChannelCents: CashClosureChannelTotals;
  operatorCount: number;
  unreportedLineCount: number;
  pendingLineCount: number;
  reportedDivergentLineCount: number;
  divergentLineCount: number;
  reportedMatchedLineCount: number;
  matchedLineCount: number;
  source: CashClosureSource;
  sourceHash: string;
  cashDeposit: CashClosureDepositState;
  approvedWithDivergence: boolean;
  pdvChangedAfterApproval: boolean;
  syncedAt: string | null;
  syncError: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalReason: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CashClosureLine = {
  id: string;
  closureId: string;
  workspaceId: string;
  kioskId: string;
  date: string;
  operatorId: string;
  operatorName: string;
  channel: CashClosureChannel;
  channelLabel: string;
  expectedCents: number;
  reportedCents: number | null;
  reportedDifferenceCents: number | null;
  countedCents: number | null;
  conferenceDifferenceCents: number | null;
  differenceCents: number | null;
  status: CashClosureLineStatus;
  rawPaymentNames: string[];
  metadata: CashClosureLineMetadata;
  reportedNote: string | null;
  note: string | null;
  reportedBy: string | null;
  reportedAt: string | null;
  countedBy: string | null;
  countedAt: string | null;
  updatedAt: string;
};

export type CashClosureAuditAction =
  | "created_from_pdv"
  | "pdv_resynced"
  | "reported_amount_updated"
  | "reported_note_updated"
  | "counted_amount_updated"
  | "note_updated"
  | "submitted"
  | "approved"
  | "reopened"
  | "deposit_allocated"
  | "deposit_adjustment_created"
  | "deposit_adjustment_allocated"
  | "deposit_issued"
  | "deposit_paid"
  | "deposit_cancelled";

export type CashClosureAuditLog = {
  id: string;
  workspaceId: string;
  closureId: string;
  lineId?: string;
  action: CashClosureAuditAction;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  userId: string;
  userName: string;
  createdAt: string;
};

export type CashClosureActor = {
  userId: string;
  userName: string;
};

export type CashClosureDraftLineInput = {
  id: string;
  reportedCents?: number | null;
  countedCents?: number | null;
  reportedNote?: string | null;
  note?: string | null;
};

export type CashClosureWithLines = {
  closure: CashClosure;
  lines: CashClosureLine[];
};

export type CashClosureMonthlySummary = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  year: number;
  month: number;
  closureCount: number;
  pendingCount: number;
  divergentCount: number;
  approvedCount: number;
  syncErrorCount: number;
  expectedTotalCents: number;
  countedTotalCents: number;
  differenceTotalCents: number;
  countedCashCents: number;
  allocatedCashCents: number;
  issuedCashCents: number;
  paidCashCents: number;
  lastSyncedAt: string | null;
  lastApprovedDate: string | null;
  updatedAt: string;
};

export type CashClosureUnitSummary = CashClosureMonthlySummary & {
  currentYear: number;
  currentMonth: number;
};
