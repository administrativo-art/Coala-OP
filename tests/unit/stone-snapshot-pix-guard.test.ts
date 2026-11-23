import assert from "node:assert/strict";
import test from "node:test";

import { stoneSnapshotMissesPixSource } from "../../src/features/financial/receipts-reconciliation/snapshot-pix-guard";

const october = { from: "2026-10-01", through: "2026-10-31" };
const everyDay = Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);

test("retrato sem Pix em nenhum dia do período não pode ser salvo", () => {
  assert.equal(stoneSnapshotMissesPixSource({ period: october, coverage: { pixUnavailableDates: everyDay } }), true);
});

test("retrato com Pix lido em algum dia, ou sem dia indisponível, pode ser salvo", () => {
  assert.equal(stoneSnapshotMissesPixSource({ period: october, coverage: { pixUnavailableDates: everyDay.slice(0, 30) } }), false);
  assert.equal(stoneSnapshotMissesPixSource({ period: october, coverage: { pixUnavailableDates: [] } }), false);
});

test("repetir a mesma data não conta como mais dias indisponíveis", () => {
  assert.equal(stoneSnapshotMissesPixSource({ period: october, coverage: { pixUnavailableDates: Array(31).fill("2026-10-01") } }), false);
});

test("período inválido não bloqueia por engano", () => {
  assert.equal(stoneSnapshotMissesPixSource({ period: { from: "x", through: "y" }, coverage: { pixUnavailableDates: [] } }), false);
});

test("resultado sem cobertura informada não é bloqueado", () => {
  assert.equal(stoneSnapshotMissesPixSource({ period: october }), false);
  assert.equal(stoneSnapshotMissesPixSource({ period: october, coverage: {} }), false);
});
