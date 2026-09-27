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

test("receita da DRE usa exclusivamente fonte integral versionada", () => {
  assert.equal(cashClosureDreRevenueCents([
    { date: "2026-09-01", pdvSales: { version: 1, amountCents: 10_000 } },
    { date: "2026-09-02", pdvSales: { version: 1, amountCents: 20_000 } },
    { date: "2026-09-03", pdvSales: { version: 1, amountCents: 30_000 } },
  ]), 60_000);
  assert.equal(cashClosureDreRevenueCents([{ date: "2026-09-01" }]), null);
});
