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
export type CashClosureOperatorStatus = "draft" | "approved" | "reopened";

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
  movementEndpoints?: readonly ["sangriasuprimento/getSangria", "sangriasuprimento/getSuprimento"];
  couponCount: number;
  validCouponCount: number;
  ignoredCancelledCouponCount: number;
  estornadoCouponCount: number;
  itemCount: number;
  paymentRowCount: number;
  rawPaymentNames: string[];
  unknownPaymentNames: string[];
  integrityWarnings: string[];
  movementCount?: number;
  ignoredCancelledMovementCount?: number;
  ignoredNonCashMovementCount?: number;
  unassignedMovementCount?: number;
};

export type CashClosureCashMovementKind = "supply" | "withdrawal";

export type CashClosureCashMovement = {
  id: string;
  kind: CashClosureCashMovementKind;
  amountCents: number;
  occurredAt: string;
  date: string;
  operatorId: string | null;
  terminalId: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  isCash: boolean;
  cancelled: boolean;
};

export type CashClosureLineMetadata = {
  grossCashCents?: number;
  changeCents?: number;
  supplyCents?: number;
  withdrawalCents?: number;
  cashMovements?: CashClosureCashMovement[];
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
  calculatedExpectedAmountCents: number;
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
 * pelo próprio PDV; dinheiro e demais canais aguardam as declarações manuais
 * e independentes do Caixa e do Financeiro.
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
  cashMovements?: CashClosureCashMovement[];
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
  /** Totais de progresso permitem representar dias parcialmente processados por operador. */
  allocatedCents?: number;
  issuedCents?: number;
  paidCents?: number;
  batchId: string | null;
  batchItemId: string | null;
  status: CashClosureDepositStatus;
  manualSplitRequired: boolean;
  manualSplitBatchIds?: string[];
  adjustmentId?: string | null;
  allocationReason: "amount_exceeds_limit" | "pending_allocator" | "awaiting_counting_session" | null;
  pendingSince: string | null;
};

export type CashClosureDepositPolicy = "standard" | "dre_only";

export type CashDepositPeriodPolicy = {
  id: string;
  workspaceId: string;
  year: number;
  month: number;
  policy: CashClosureDepositPolicy;
  reason: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
  finalizedCountedTotalCents: number;
  finalizedDifferenceTotalCents: number;
  finalizedCountedCashCents: number;
  cashDepositEligibleCents: number;
  expectedByChannelCents: CashClosureChannelTotals;
  reportedByChannelCents: CashClosureChannelTotals;
  countedByChannelCents: CashClosureChannelTotals;
  reportedDifferenceByChannelCents: CashClosureChannelTotals;
  differenceByChannelCents: CashClosureChannelTotals;
  operatorCount: number;
  finalizedOperatorCount: number;
  unreportedLineCount: number;
  pendingLineCount: number;
  reportedDivergentLineCount: number;
  divergentLineCount: number;
  reportedMatchedLineCount: number;
  matchedLineCount: number;
  source: CashClosureSource;
  sourceHash: string;
  /** Permite preservar a conferência na DRE sem encaminhar o numerário ao fluxo de depósitos. */
  cashDepositPolicy?: CashClosureDepositPolicy;
  cashDepositPolicyReason?: string | null;
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

export type CashClosureOperator = {
  id: string;
  closureId: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  date: string;
  operatorId: string;
  operatorName: string;
  status: CashClosureOperatorStatus;
  expectedTotalCents: number;
  reportedTotalCents: number;
  countedTotalCents: number;
  reportedDifferenceTotalCents: number;
  differenceTotalCents: number;
  countedCashCents: number;
  unreportedLineCount: number;
  pendingLineCount: number;
  reportedDivergentLineCount: number;
  divergentLineCount: number;
  cashDeposit: CashClosureDepositState;
  countingSessionId?: string | null;
  countingSessionFinalizedAt?: string | null;
  approvedWithDivergence: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
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
  calculatedExpectedCents: number;
  expectedCents: number;
  expectedAdjustmentCents: number;
  expectedAdjustmentReason: string | null;
  expectedAdjustedBy: string | null;
  expectedAdjustedAt: string | null;
  expectedAdjustmentNeedsReview: boolean;
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
  | "expected_amount_adjusted"
  | "expected_amount_restored"
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
  | "deposit_cancelled"
  | "deposit_excluded"
  | "operator_states_migrated";

export type CashClosureAuditLog = {
  id: string;
  workspaceId: string;
  closureId: string;
  lineId?: string;
  operatorId?: string;
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

export type CashClosureExpectedAdjustmentInput = {
  lineId: string;
  correctedExpectedCents: number;
  reason: string;
};

export type CashClosureWithLines = {
  closure: CashClosure;
  lines: CashClosureLine[];
  operators: CashClosureOperator[];
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
  partialCount?: number;
  divergentCount: number;
  approvedCount: number;
  syncErrorCount: number;
  expectedTotalCents: number;
  countedTotalCents: number;
  differenceTotalCents: number;
  /** Receita da DRE: PDV nos operadores em aberto e valor conferido nos finalizados. */
  dreRevenueTotalCents: number;
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
