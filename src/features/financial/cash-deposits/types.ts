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
  sequence: number;
  status: CashDepositBatchStatus;
  maxCents: number;
  totalCents: number;
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

export type CashDepositBatchItemSource = "cash_counted" | "cash_adjustment" | "manual_split";

export type CashDepositBatchItem = {
  id: string;
  workspaceId: string;
  batchId: string;
  closureId: string;
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

export type CashDepositAllocationDecision =
  | "not_eligible"
  | "manual_split_required"
  | "append_to_open_batch"
  | "lock_and_create_batch";
