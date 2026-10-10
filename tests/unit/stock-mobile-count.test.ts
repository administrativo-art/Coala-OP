import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyMobileCountEntries,
  isMobileCountProduct,
  mobileCountDisplayUnit,
  mobileCountEntrySchema,
  mobileCountProductName,
  saveMobileCountSchema,
  toMobileCountItem,
} from "../../src/features/stock-count/mobile-count";
import { defaultAdminPermissions, defaultGuestPermissions, type Product, type StockAuditItem } from "../../src/types";

const item = (lotId: string, systemQuantity: number): StockAuditItem => ({
  productId: `product-${lotId}`, productName: `Produto ${lotId}`, lotId, lotNumber: "L1", expiryDate: "", systemQuantity,
  displayUnit: "un", finalQuantity: systemQuantity, divergences: [], adjustments: [],
});
const entry = (lotId: string, patch: Record<string, unknown> = {}) => ({
  lotId, exitQuantity: 0, exitReason: "SAIDA_CONSUMO" as const, exitNotes: "", entryQuantity: 0, entryNotes: "", ...patch,
});

test("count entries become one exit and one entry per lot and untouched lots keep the system quantity", () => {
  const result = applyMobileCountEntries([item("a", 10), item("b", 4), item("c", 2.5)], [
    entry("a", { exitQuantity: 3, exitReason: "SAIDA_DESCARTE_AVARIA", exitNotes: "caixa amassada" }),
    entry("c", { exitQuantity: 0.5, entryQuantity: 1 }),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0]!.finalQuantity, 7);
  assert.deepEqual(result.items[0]!.divergences, [{ id: "mobile-exit", reason: "SAIDA_DESCARTE_AVARIA", quantity: 3, notes: "caixa amassada" }]);
  assert.deepEqual(result.items[0]!.adjustments, []);
  assert.equal(result.items[1]!.finalQuantity, 4);
  assert.deepEqual(result.items[1]!.divergences, []);
  assert.equal(result.items[2]!.finalQuantity, 3);
  assert.equal(result.items[2]!.adjustments[0]!.reason, "ENTRADA_CORRECAO");
});

test("the app cannot add lots, repeat a lot or drive stock negative", () => {
  const session = [item("a", 2)];
  assert.equal(applyMobileCountEntries(session, [entry("x", { exitQuantity: 1 })]).ok, false);
  assert.equal(applyMobileCountEntries(session, [entry("a", { exitQuantity: 1 }), entry("a", { exitQuantity: 1 })]).ok, false);
  assert.equal(applyMobileCountEntries(session, [entry("a", { exitQuantity: 3 })]).ok, false);
  assert.equal(applyMobileCountEntries(session, [entry("a", { exitQuantity: 3, entryQuantity: 1 })]).ok, true);
});

test("decimal quantities do not accumulate floating point noise", () => {
  const result = applyMobileCountEntries([item("a", 0.3)], [entry("a", { exitQuantity: 0.1 })]);
  assert.equal(result.ok && result.items[0]!.finalQuantity, 0.2);
});

test("entry schema is strict, bounded and requires a description for Outros", () => {
  assert.equal(mobileCountEntrySchema.safeParse(entry("a", { exitQuantity: 1 })).success, true);
  assert.equal(mobileCountEntrySchema.safeParse(entry("a", { exitQuantity: -1 })).success, false);
  assert.equal(mobileCountEntrySchema.safeParse(entry("a", { exitQuantity: 1, exitReason: "ENTRADA" })).success, false);
  assert.equal(mobileCountEntrySchema.safeParse(entry("a", { exitQuantity: 1, exitReason: "SAIDA_DESCARTE_OUTROS" })).success, false);
  assert.equal(mobileCountEntrySchema.safeParse(entry("a", { exitQuantity: 1, exitReason: "SAIDA_DESCARTE_OUTROS", exitNotes: "amostra" })).success, true);
  assert.equal(mobileCountEntrySchema.safeParse({ ...entry("a"), finalQuantity: 99 }).success, false);
  assert.equal(mobileCountEntrySchema.safeParse(entry("a/b")).success, false);
  assert.equal(saveMobileCountSchema.safeParse({ sessionId: "s1", entries: [], complete: true }).success, true);
  assert.equal(saveMobileCountSchema.safeParse({ sessionId: "s1", entries: [], complete: true, kioskId: "other" }).success, false);
});

test("the app list mirrors the web count: exclusions, counting unit and product name", () => {
  const product = { baseName: "Leite", brand: "Marca", packageSize: 1, unit: "L", packageType: "caixa" } as unknown as Product;
  assert.equal(mobileCountProductName(product), "Leite - Marca (1L)");
  assert.equal(isMobileCountProduct(product), true);
  assert.equal(isMobileCountProduct({ ...product, isArchived: true }), false);
  assert.equal(isMobileCountProduct({ ...product, operationalDestination: "uniform" }), false);
  assert.equal(isMobileCountProduct({ ...product, category: "Vestimenta" } as unknown as Product), false);
  assert.equal(isMobileCountProduct(undefined), false);
  assert.equal(mobileCountDisplayUnit(product, "ml"), "caixa");
  assert.equal(mobileCountDisplayUnit({ ...product, defaultCountingUnit: "base" }, "ml"), "ml");
  assert.equal(mobileCountDisplayUnit({ ...product, defaultCountingUnit: "content" }, "ml"), "L");
});

test("a saved draft reads back as the single exit and entry the app edits", () => {
  const applied = applyMobileCountEntries([item("a", 10)], [entry("a", { exitQuantity: 2, exitReason: "SAIDA_DESCARTE_PERDA", entryQuantity: 1, entryNotes: "achado" })]);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  const view = toMobileCountItem(applied.items[0]!);
  assert.equal(view.exitQuantity, 2);
  assert.equal(view.exitReason, "SAIDA_DESCARTE_PERDA");
  assert.equal(view.entryQuantity, 1);
  assert.equal(view.entryNotes, "achado");
  assert.equal(toMobileCountItem(item("b", 3)).exitReason, "SAIDA_CONSUMO");
});

test("count routes use the app permission, the owner check and the shared finalizer", () => {
  const server = readFileSync("src/features/stock-count/mobile-count.server.ts", "utf8");
  assert.match(server, /permissions\.app\?\.stockCount\?\.perform !== true/);
  // Counting in the web system must not open the app, nor the other way round.
  assert.doesNotMatch(server, /permissions\.stock/);
  assert.equal(defaultGuestPermissions.app.stockCount.perform, false);
  assert.equal(defaultAdminPermissions.app.stockCount.perform, true);
  assert.match(server, /isStockCountOwner\(actor, session\)/);
  assert.match(server, /completeStockCountSession\(\{ context: actor, sessionId: input\.sessionId, items: applied\.items \}\)/);
  assert.match(server, /if \(existing\) return \{ session: await sessionPayload\(existing\), resumed: true \}/);
  // Product photo: only https links from the registration, as the web count shows.
  assert.match(server, /imageUrl: safeAvatarUrl\(snapshot\.get\("imageUrl"\)\)/);
  for (const route of ["route.ts", "start/route.ts", "save/route.ts"]) {
    const source = readFileSync(`src/app/api/stock/mobile-count/${route}`, "utf8");
    assert.match(source, /action: "app\.stock-count\.perform"/);
    assert.match(source, /assertCanPerformMobileCount\(actor\)/);
    assert.match(source, /secureRoute\(\{ contract, enforcer \}/);
  }
});
