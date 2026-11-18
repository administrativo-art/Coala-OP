import test from "node:test";
import assert from "node:assert/strict";
import { createDreReportPreview } from "../../src/features/financial/dre/report-preview";
import { reconcileDreCmv, type CompositionReconciliationInput, type StockReconciliationInput } from "../../src/features/financial/dre/cmv-reconciliation";
import { calculateProductCompositionCmv } from "../../src/lib/product-composition-cmv";
import type { BaseProduct } from "../../src/types";
function inputs() {
  const base = { id: "same-id", name: "Mesmo nome", unit: "g", category: "Massa", initialCostPerUnit: .01 } as BaseProduct;
  const composition = calculateProductCompositionCmv([{ id: "line", simulationId: "recipe", baseProductId: base.id, quantity: 1000, useDefault: true }], new Map([[base.id, base]]));
  const stock: StockReconciliationInput = { complete: true, diagnostics: [], rows: [{ kioskId: "a", baseProductId: base.id, name: base.name, unit: "g", category: "Massa", quantity: 1200, value: 14.4, kind: "consumption", initialCost: false }] };
  const c: CompositionReconciliationInput = { kioskId: "a", period: "2026-10", status: "open", complete: true, sourceChanged: false, referenceAt: "2026-11-17", totalCmv: 10, products: [{ simulationId: "recipe", quantity: 1, unitCmv: 10, totalCmv: 10, composition }] };
  return { stock, composition: [c], kioskIds: ["a"], stockTotal: 14.4, period: "2026-10" };
}
test("ponte conserva total com efeitos de quantidade, preço, fora das fichas, descartes e ajustes", () => {
  const c = createDreReportPreview().cmvReconciliation!;
  assert.equal(c.available, true); assert.equal(c.stockTotal, 9300); assert.equal(c.compositionTotal, 9000);
  assert.deepEqual(c.totals && [c.totals.quantityEffect, c.totals.priceEffect, c.totals.unplannedValue, c.totals.discardedValue, c.totals.adjustedValue], [900, -770, 20, 50, 100]);
  assert.equal(c.totals?.difference, 300); assert.equal(c.residual, 0); assert.equal(c.totals?.initialCostValue, 20); assert.ok(c.rows.some(r => r.overridePrice));
});
test("IDs distintos de mesmo nome não são fundidos; subconjuntos não somam outra unidade", () => {
  const input = inputs(); input.stock.rows.push({ ...input.stock.rows[0], baseProductId: "different-id", quantity: 2, value: 3 }); input.stockTotal += 3;
  const c = reconcileDreCmv(input); assert.equal(c.available, true); assert.equal(c.rows.length, 2); assert.equal(c.totals?.unplannedValue, 3);
  assert.equal(c.rows.find(r => r.baseProductId === "different-id")?.expectedQty, 0);
});
test("converte unidades oficiais na referência congelada e recusa fonte alterada, incompleta ou residual", () => {
  const input = inputs(); const line = input.composition[0].products[0].composition.lines[0]; line.quantity = 1; line.unit = "kg";
  input.composition[0].status = "closed"; input.composition[0].revision = 2; input.composition[0].sourceFingerprint = "source-hash"; input.composition[0].salesFingerprint = "sales-hash";
  const c = reconcileDreCmv(input); assert.equal(c.available, true); assert.equal(c.rows[0].expectedQty, 1000); assert.match(c.basis, /congeladas/);
  input.composition[0].sourceChanged = true; assert.equal(reconcileDreCmv(input).available, false);
  input.composition[0].sourceChanged = false; input.composition[0].totalCmv = 11; assert.equal(reconcileDreCmv(input).available, false);
  input.composition[0].totalCmv = 10; input.stock.complete = false; assert.equal(reconcileDreCmv(input).available, false);
});
test("unidades incompatíveis e referência ausente não viram diferença de quantidade zero", () => {
  const input = inputs(); input.composition[0].products[0].composition.lines[0].unit = "un";
  assert.equal(reconcileDreCmv(input).available, false); input.composition = [];
  const c = reconcileDreCmv(input); assert.equal(c.available, false); assert.equal(c.totals, null);
});

test("preserva revisão, fingerprints e referências de custo sem identidades pessoais", () => {
  const input = inputs(); Object.assign(input.composition[0], { status: "closed", revision: 3, sourceFingerprint: "snapshot-abc", salesFingerprint: "sales-def", referenceAt: "2026-11-10T15:00:00Z" });
  Object.assign(input.stock.rows[0], { costReferenceId: "effective-cost-1", costReferenceAt: "2026-09-01T15:00:00Z", appliedCost: .012 });
  const c = reconcileDreCmv(input); assert.equal(c.available, true);
  const snapshot = c.references.find(r => r.kind === "composition")!;
  assert.equal(snapshot.revision, 3); assert.equal(snapshot.sourceFingerprint, "snapshot-abc"); assert.equal(snapshot.salesFingerprint, "sales-def"); assert.equal(snapshot.referenceAt, "2026-11-10T15:00:00Z");
  const cost = c.references.find(r => r.kind === "stock_cost")!;
  assert.equal(cost.referenceId, "effective-cost-1"); assert.equal(cost.referenceAt, "2026-09-01T15:00:00Z"); assert.equal(cost.appliedPrice, .012);
  delete input.composition[0].sourceFingerprint; assert.equal(reconcileDreCmv(input).available, false);
});
test("referência do custo efetivo é a mesma data/ID usada na valorização, sem custo futuro", async () => {
  const { buildStockReconciliationInput } = await import("../../src/features/financial/dre/cmv-reconciliation");
  const context = { productsById: new Map([["p", { id: "p", baseProductId: "b", unit: "g", packageSize: 1, category: "Massa" }]]),
    baseProductsById: new Map([["b", { id: "b", name: "Base", unit: "g", category: "Massa", initialCostPerUnit: .1 }]]),
    effectiveCostsByBaseProductId: new Map([["b", [{ id: "old", occurredAt: "2026-09-01", unitCost: .2 }, { id: "selected", occurredAt: "2026-10-01", unitCost: .3 }, { id: "future", occurredAt: "2026-11-01", unitCost: 9 }]]]) } as unknown as Parameters<typeof buildStockReconciliationInput>[1];
  const movements = [{ id: "m", type: "SAIDA_CONSUMO", productId: "p", fromKioskId: "a", timestamp: "2026-10-15T15:00:00Z", quantityChange: 10 }] as Parameters<typeof buildStockReconciliationInput>[0];
  const row = buildStockReconciliationInput(movements, context).rows[0];
  assert.equal(row.value, 3); assert.equal(row.costReferenceId, "selected"); assert.equal(row.costReferenceAt, "2026-10-01"); assert.equal(row.initialCost, false);
  const initial = buildStockReconciliationInput(movements, { ...context, effectiveCostsByBaseProductId: new Map() }).rows[0];
  assert.equal(initial.value, 1); assert.equal(initial.costReferenceId, "b"); assert.equal(initial.costReferenceAt, null); assert.equal(initial.initialCost, true);
});
