import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateNegativeAdjustmentWithoutGoingBelowZero,
  appendClosureAllocationIdempotently,
  decideCashDepositAllocation,
} from "../../src/features/financial/cash-deposits/allocation";

test("bloco em exatamente 500000 permanece aberto", () => {
  assert.equal(decideCashDepositAllocation({ currentBatchCents: 400_000, amountCents: 100_000 }), "append_to_open_batch");
});

test("próximo valor que ultrapassa trava o bloco e abre outro", () => {
  assert.equal(decideCashDepositAllocation({ currentBatchCents: 400_000, amountCents: 100_001 }), "lock_and_create_batch");
});

test("um único dia acima do limite exige divisão manual", () => {
  assert.equal(decideCashDepositAllocation({ currentBatchCents: null, amountCents: 500_001 }), "manual_split_required");
});

test("ajuste negativo maior que o saldo não deixa bloco negativo", () => {
  assert.deepEqual(
    allocateNegativeAdjustmentWithoutGoingBelowZero({ batchTotalCents: 10_000, requestedDeltaCents: -15_000 }),
    { allocatedDeltaCents: -10_000, pendingDeltaCents: -5_000 },
  );
});

test("alocador idempotente não soma o mesmo fechamento duas vezes", () => {
  const first = appendClosureAllocationIdempotently({
    closureIds: [], itemCount: 0, totalCents: 0, closureId: "closure-1", amountCents: 100_000,
  });
  const second = appendClosureAllocationIdempotently({
    closureIds: first.closureIds,
    itemCount: first.itemCount,
    totalCents: first.totalCents,
    closureId: "closure-1",
    amountCents: 100_000,
  });
  assert.deepEqual(second, {
    closureIds: ["closure-1"], itemCount: 1, totalCents: 100_000, added: false,
  });
});
