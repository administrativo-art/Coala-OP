export const CASH_DEPOSIT_MAX_CENTS = 500_000;

export type CashDepositBatchStatus =
  | "open"
  | "locked"
  | "issuing"
  | "issued"
  | "paid"
  | "cancelled"
  | "failed";

export type CashDepositBatchLockReason =
  | "next_item_would_exceed_limit"
  | "manual_issue_requested"
  | "manual_lock"
  | null;

export type CashDepositBatch = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  kioskIds?: string[];
  kioskNames?: string[];
  sourceScope?: "unit" | "counting_session";
  countingSessionId?: string | null;
  countingSessionBagId?: string | null;
  denominations?: Array<{
    valueCents: number;
    kind: "note" | "coin";
    quantity: number;
    totalCents: number;
  }>;
  sequence: number;
  status: CashDepositBatchStatus;
  maxCents: number;
  grossTotalCents: number;
  totalCents: number;
  coinHoldCents: number;
  coinPreparedAt: string | null;
  coinPreparedBy: string | null;
  remainingCapacityCents: number;
  periodStartDate: string;
  periodEndDate: string;
  closureIds: string[];
  dates: string[];
  itemCount: number;
  lockReason: CashDepositBatchLockReason;
  nextRejectedClosureId: string | null;
  nextRejectedCents: number | null;
  bankProvider: "inter" | null;
  interCobrancaId: string | null;
  interCobrancaIds: string[];
  bankWarning: string | null;
  lastBankSyncAt: string | null;
  ledgerTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  issuedBy: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
};

export type CashDepositBatchItemSource =
  | "cash_counted"
  | "cash_adjustment"
  | "manual_split"
  | "coin_hold"
  | "coin_exchange"
  | "counting_session";

export type CashDepositBatchItem = {
  id: string;
  workspaceId: string;
  batchId: string;
  closureId: string;
  operatorId?: string | null;
  operatorName?: string | null;
  closureDate: string;
  kioskId: string;
  amountCents: number;
  source: CashDepositBatchItemSource;
  operatorBreakdown: Array<{
    operatorId: string;
    operatorName: string;
    amountCents: number;
  }>;
  createdAt: string;
};

export type CashDepositAdjustment = {
  id: string;
  workspaceId: string;
  kioskId: string;
  closureId: string;
  batchId: string;
  originalCents: number;
  revisedCents: number;
  deltaCents: number;
  allocatedCents: number;
  pendingAllocationCents: number;
  targetBatchIds: string[];
  reason: string;
  status: "pending_allocation" | "allocated" | "resolved";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type CashCoinBalance = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pendingExchangeCents: number;
  exchangedCents: number;
  updatedAt: string;
};

export type CashCoinEvent = {
  id: string;
  workspaceId: string;
  kioskId: string;
  batchId: string;
  type: "held_for_exchange" | "exchanged_to_notes" | "hold_adjusted";
  amountCents: number;
  previousBalanceCents: number;
  newBalanceCents: number;
  actorId: string;
  actorName: string;
  createdAt: string;
};

export type CashDepositAllocationDecision =
  | "not_eligible"
  | "manual_split_required"
  | "append_to_open_batch"
  | "lock_and_create_batch";

export function normalizeCashDepositBatch(batch: CashDepositBatch): CashDepositBatch {
  const coinHoldCents = batch.coinHoldCents ?? 0;
  return {
    ...batch,
    kioskIds: batch.kioskIds?.length ? batch.kioskIds : [batch.kioskId],
    kioskNames: batch.kioskNames?.length ? batch.kioskNames : [batch.kioskName],
    sourceScope: batch.sourceScope ?? "unit",
    grossTotalCents: batch.grossTotalCents ?? batch.totalCents + coinHoldCents,
    coinHoldCents,
    coinPreparedAt: batch.coinPreparedAt ?? null,
    coinPreparedBy: batch.coinPreparedBy ?? null,
  };
}
