import assert from "node:assert/strict";
import test from "node:test";

import {
  cashClosureDreRevenueCents,
  cashClosureSummaryDreRevenueCents,
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

test("receita da DRE usa o PDV e mantém diferenças físicas separadas", () => {
  assert.equal(cashClosureDreRevenueCents([
    { expectedTotalCents: 10_000, finalizedDifferenceTotalCents: 500 },
    { expectedTotalCents: 20_000, finalizedDifferenceTotalCents: -1_000 },
    { expectedTotalCents: 30_000, finalizedDifferenceTotalCents: 0 },
  ]), 60_000);
});

test("leitura ignora receita legada contaminada por diferença de caixa", () => {
  assert.equal(cashClosureSummaryDreRevenueCents({
    expectedTotalCents: 30_000,
    differenceTotalCents: -1_000,
    dreRevenueTotalCents: 29_000,
  }), 30_000);
});

test("mês sem resumo consolidado inicia a receita da DRE em zero", () => {
  assert.equal(cashClosureSummaryDreRevenueCents({}), 0);
});
