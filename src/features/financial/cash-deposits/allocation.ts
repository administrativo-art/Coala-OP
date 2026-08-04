import { CASH_DEPOSIT_MAX_CENTS, type CashDepositAllocationDecision } from "./types";

export function decideCashDepositAllocation(input: {
  currentBatchCents: number | null;
  amountCents: number;
  maxCents?: number;
}): CashDepositAllocationDecision {
  const maxCents = input.maxCents ?? CASH_DEPOSIT_MAX_CENTS;
  if (input.amountCents <= 0) return "not_eligible";
  if (input.amountCents > maxCents) return "manual_split_required";
  if (input.currentBatchCents === null) return "append_to_open_batch";
  return input.currentBatchCents + input.amountCents <= maxCents
    ? "append_to_open_batch"
    : "lock_and_create_batch";
}

export function allocateNegativeAdjustmentWithoutGoingBelowZero(input: {
  batchTotalCents: number;
  requestedDeltaCents: number;
}) {
  if (input.requestedDeltaCents >= 0) {
    return { allocatedDeltaCents: input.requestedDeltaCents, pendingDeltaCents: 0 };
  }
  const allocatedDeltaCents = -Math.min(input.batchTotalCents, Math.abs(input.requestedDeltaCents));
  return {
    allocatedDeltaCents,
    pendingDeltaCents: input.requestedDeltaCents - allocatedDeltaCents,
  };
}

export function appendClosureAllocationIdempotently(input: {
  closureIds: string[];
  itemCount: number;
  totalCents: number;
  closureId: string;
  amountCents: number;
}) {
  if (input.closureIds.includes(input.closureId)) {
    return {
      closureIds: input.closureIds,
      itemCount: input.itemCount,
      totalCents: input.totalCents,
      added: false,
    };
  }
  return {
    closureIds: [...input.closureIds, input.closureId],
    itemCount: input.itemCount + 1,
    totalCents: input.totalCents + input.amountCents,
    added: true,
  };
}
