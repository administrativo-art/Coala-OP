import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { prepareStoneReconciliationBackfill } from "../../src/features/financial/sales-reconciliation/backfill";

const sourceHash = "0".repeat(64);

function pdvBatch(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "coala-shakes",
    source: "pdv",
    period: "2026-08",
    idempotencyKey: "backfill-pdv-2026-08-001",
    finalize: false,
    rows: [{
      kioskId: "tirirical",
      kioskName: "Tirirical",
      couponId: "coupon-1",
      paymentIndex: 0,
      soldAt: "2026-08-05T10:00:00-03:00",
      channel: "pix",
      grossAmountCents: 2_500,
      status: "approved",
      identifiers: { providerTransactionId: "provider-1" },
      sourceHash,
      sourceRevision: "1",
    }],
    ...overrides,
  };
}

function stoneBatch(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "coala-shakes",
    source: "stone_sales",
    period: "2026-08",
    idempotencyKey: "backfill-stone-2026-08-001",
    finalize: true,
    rows: [{
      externalTransactionId: "stone-1",
      stoneCode: "stonecode-1",
      kioskId: "tirirical",
      kioskName: "Tirirical",
      soldAt: "2026-08-05T10:00:00-03:00",
      channel: "pix",
      grossAmountCents: 2_500,
      installmentCount: 1,
      status: "approved",
      identifiers: { providerTransactionId: "provider-1" },
      sourceHash,
      sourceRevision: "1",
    }],
    ...overrides,
  };
}

function receivableBatch() {
  return {
    workspaceId: "coala-shakes",
    source: "stone_receivables",
    idempotencyKey: "backfill-receivables-2026-08-001",
    rows: [{
      receivableKey: "stone-1:installment-1",
      externalSaleId: "stone-1",
      installmentNumber: 1,
      installmentCount: 1,
      stoneCode: "stonecode-1",
      kioskId: "tirirical",
      accountId: "stone-account",
      grossAmountCents: 2_500,
      mdrAmountCents: 50,
      anticipationFeeAmountCents: 0,
      adjustmentAmountCents: 0,
      netAmountCents: 2_450,
      settledAmountCents: 0,
      originalExpectedDate: "2026-08-06",
      currentExpectedDate: "2026-08-06",
      status: "scheduled",
      sourceRevision: "1",
      sourceHash,
    }],
  };
}

test("dry-run do backfill compara totais e produz hash revisável", () => {
  const result = prepareStoneReconciliationBackfill({
    workspaceId: "coala-shakes",
    approvedKioskIds: ["tirirical"],
    batches: [
      { fileName: "01-pdv.json", raw: pdvBatch() },
      { fileName: "02-stone.json", raw: stoneBatch() },
      { fileName: "03-receivables.json", raw: receivableBatch() },
    ],
  });
  assert.equal(result.report.readyToExecute, true);
  assert.equal(result.report.rows.pdv, 1);
  assert.equal(result.report.rows.stoneSales, 1);
  assert.equal(result.report.rows.stoneReceivables, 1);
  assert.equal(result.report.sales.periods[0]?.differenceAmountCents, 0);
  assert.equal(result.report.sales.casesByKind.matched, 1);
  assert.equal(result.report.feeAccounting.missingSaleCount, 0);
  assert.match(result.report.reviewHash, /^[a-f0-9]{64}$/);
});

test("backfill bloqueia unidade não aprovada e venda Stone sem mapeamento", () => {
  const result = prepareStoneReconciliationBackfill({
    workspaceId: "coala-shakes",
    approvedKioskIds: [],
    batches: [
      { fileName: "01-pdv.json", raw: pdvBatch() },
      { fileName: "02-stone.json", raw: stoneBatch({
        rows: [{ ...stoneBatch().rows[0], kioskId: null }],
      }) },
    ],
  });
  assert.equal(result.report.readyToExecute, false);
  assert.equal(result.report.sales.unmappedStoneSaleCount, 1);
  assert.ok(result.report.blockers.some((blocker) => blocker.includes("sem unidade canônica")));
  assert.ok(result.report.blockers.some((blocker) => blocker.includes("tirirical")));
});

test("backfill recusa duas revisões da mesma venda no mesmo conjunto", () => {
  assert.throws(() => prepareStoneReconciliationBackfill({
    workspaceId: "coala-shakes",
    approvedKioskIds: ["tirirical"],
    batches: [
      { fileName: "01-pdv.json", raw: pdvBatch() },
      { fileName: "02-pdv.json", raw: pdvBatch({
        idempotencyKey: "backfill-pdv-2026-08-002",
        rows: [{ ...pdvBatch().rows[0], grossAmountCents: 2_600, sourceRevision: "2" }],
      }) },
      { fileName: "03-stone.json", raw: stoneBatch() },
    ],
  }), /revisões conflitantes/);
});

test("script exige relatório revisado antes de qualquer escrita", async () => {
  const script = await readFile(new URL("../../scripts/backfill-stone-reconciliation.mts", import.meta.url), "utf8");
  assert.match(script, /reviewed-report/);
  assert.match(script, /readyToExecute/);
  assert.match(script, /confirm-workspace/);
  assert.ok(script.indexOf("reviewedReport !== plan.report.reviewHash") < script.indexOf("importCanonicalSalesBatch"));
});

test("migrações de rollout permanecem dry-run por padrão", async () => {
  const [permissions, account] = await Promise.all([
    readFile(new URL("../../scripts/migrate-stone-reconciliation-permissions.mts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/migrate-cash-difference-account.mts", import.meta.url), "utf8"),
  ]);
  assert.match(permissions, /currentSales\.view \?\? admin/);
  assert.match(permissions, /currentStone\.manage \?\? admin/);
  assert.match(permissions, /const execute = process\.argv\.includes\("--execute"\)/);
  assert.match(permissions, /MIGRATE-STONE-RECONCILIATION-PERMISSIONS-V1/);
  assert.match(account, /batch\.create\(accountRef/);
  assert.match(account, /CREATE-CASH-DIFFERENCE-ACCOUNT-V1/);
  assert.match(account, /const execute = process\.argv\.includes\("--execute"\)/);
});
