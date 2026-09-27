import assert from "node:assert/strict";
import test from "node:test";
import { calculateProductCompositionCmv } from "../../src/lib/product-composition-cmv";
import { canCloseCmvPeriod, cmvClosureInputSchema } from "../../src/features/financial/dre/cmv-closure";
import type { BaseProduct, ProductSimulationItem } from "../../src/types";
const base = { id: "milk", name: "Leite", category: "Volume", unit: "l", initialCostPerUnit: 5 } as BaseProduct;
const item: ProductSimulationItem = { id: "random-item", simulationId: "shake", baseProductId: "milk", quantity: .125, useDefault: true };
const calculate = (items: ProductSimulationItem[], ingredient = base) => calculateProductCompositionCmv(items, new Map([[ingredient.id, ingredient]]));

test("CMV usa preço atual, preserva frações e cai no preço inicial somente quando efetivo ausente", () => {
  assert.equal(calculate([item]).totalCmv, .625);
  const priced = { ...base, lastEffectivePrice: { pricePerUnit: 7.33 } } as BaseProduct;
  assert.equal(calculate([item], priced).totalCmv, .91625);
  assert.equal(calculate([item], priced).lines[0].priceSource, "lastEffectivePrice");
  assert.equal(calculate([item], { ...base, lastEffectivePrice: { pricePerUnit: 0 } } as BaseProduct).totalCmv, null);
});
test("override representa preço por unidade selecionada convertido para unidade base", () => {
  const result = calculate([{ ...item, useDefault: false, overrideCostPerUnit: .01, overrideUnit: "ml" }]);
  assert.equal(result.totalCmv, 1.25);
  assert.equal(result.lines[0].conversionFactor, .001);
  assert.equal(result.lines[0].costPerBaseUnit, 10);
  assert.equal(result.lines[0].priceSource, "override");
});
test("composição incompleta não disponibiliza soma parcial nem zero", () => {
  for (const items of [[], [{ ...item, quantity: NaN }], [{ ...item, quantity: -1 }], [{ ...item, quantity: 0 }],
    [item, { ...item, id: "missing", baseProductId: "missing" }], [{ ...item, useDefault: false }],
    [{ ...item, useDefault: false, overrideCostPerUnit: 3, overrideUnit: "kg" }], [item, item]]) {
    const result = calculate(items);
    assert.equal(result.totalCmv, null); assert.equal(result.complete, false); assert.ok(result.diagnostics.length);
  }
  assert.equal(calculate([item], { ...base, unit: "invalid" }).complete, false);
  assert.equal(calculate([item], { ...base, initialCostPerUnit: Infinity }).complete, false);
});
test("fechamento só aceita mês anterior em Belém e início da série DRE", () => {
  assert.equal(canCloseCmvPeriod("2026-08", new Date("2026-09-01T02:59:00Z")), false);
  assert.equal(canCloseCmvPeriod("2026-08", new Date("2026-09-01T03:00:00Z")), true);
  assert.equal(canCloseCmvPeriod("2026-07", new Date("2026-09-27T12:00:00Z")), false);
  assert.equal(canCloseCmvPeriod("2026-09", new Date("2026-09-27T12:00:00Z")), false);
  assert.equal(canCloseCmvPeriod("2026-13", new Date("2027-01-01T12:00:00Z")), false);
});
test("schema exige conferência humana, revisão, fingerprint e motivo de reabertura", () => {
  const close = { action: "close", kioskId: "unit", period: "2026-08", expectedRevision: 0, expectedSourceFingerprint: "a".repeat(64), salesReviewed: true };
  assert.equal(cmvClosureInputSchema.safeParse(close).success, true);
  assert.equal(cmvClosureInputSchema.safeParse({ ...close, salesReviewed: false }).success, false);
  assert.equal(cmvClosureInputSchema.safeParse({ ...close, kioskId: "foreign/path" }).success, false);
  assert.equal(cmvClosureInputSchema.safeParse({ ...close, expectedRevision: -1 }).success, false);
  assert.equal(cmvClosureInputSchema.safeParse({ action: "reopen", kioskId: "unit", period: "2026-08", expectedRevision: 1, reason: "  " }).success, false);
});
