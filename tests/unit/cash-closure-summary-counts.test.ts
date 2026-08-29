import assert from "node:assert/strict";
import test from "node:test";

import {
  cashClosureDreRevenueCents,
  cashClosureSummaryCounts,
} from "../../src/features/financial/cash-closures/summary-counts";

test("resumo mensal separa dias pendentes de finalizações parciais", () => {
  const base = {
    finalizedOperatorCount: 0,
    approvedWithDivergence: false,
    syncError: null,
  };
  const counts = cashClosureSummaryCounts([
    { ...base, status: "draft" },
    { ...base, status: "reopened" },
    { ...base, status: "pending_review", finalizedOperatorCount: 1 },
    { ...base, status: "pending_review", finalizedOperatorCount: 1, approvedWithDivergence: true },
    { ...base, status: "approved", finalizedOperatorCount: 2 },
    { ...base, status: "sync_error", syncError: "PDV indisponível" },
  ]);

  assert.deepEqual(counts, {
    closureCount: 6,
    pendingCount: 2,
    partialCount: 2,
    divergentCount: 1,
    approvedCount: 1,
    syncErrorCount: 1,
  });
});

test("receita da DRE mantém o PDV em aberto e aplica somente diferenças finalizadas", () => {
  assert.equal(cashClosureDreRevenueCents([
    { expectedTotalCents: 10_000, finalizedDifferenceTotalCents: 500 },
    { expectedTotalCents: 20_000, finalizedDifferenceTotalCents: -1_000 },
    { expectedTotalCents: 30_000, finalizedDifferenceTotalCents: 0 },
  ]), 59_500);
});
