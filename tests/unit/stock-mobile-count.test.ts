import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyMobileCountEntries,
  cancelMobileCountSchema,
  mobileCountPhotoQuerySchema,
  mobileCountPhotoUrl,
  parseProductPhotoDataUri,
  isMobileCountProduct,
  mobileCountDisplayUnit,
  mobileCountEntrySchema,
  mobileCountProductName,
  saveMobileCountSchema,
  toMobileCountItem,
} from "../../src/features/stock-count/mobile-count";
import { chooseCountDrafts } from "../../apps/coala-notas/src/count-merge";
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
  assert.match(server, /imageUrl: mobileCountPhotoUrl\(snapshot\.id, snapshot\.get\("imageUrl"\)\)/);
  for (const route of ["route.ts", "start/route.ts", "save/route.ts"]) {
    const source = readFileSync(`src/app/api/stock/mobile-count/${route}`, "utf8");
    assert.match(source, /action: "app\.stock-count\.perform"/);
    assert.match(source, /assertCanPerformMobileCount\(actor\)/);
    assert.match(source, /secureRoute\(\{ contract, enforcer \}/);
  }
});

test("product photos reach the app whether the registration stores an address or the image itself", () => {
  const embedded = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  // A foto pública segue como está; a embutida no cadastro vira o caminho da rota autenticada.
  assert.equal(mobileCountPhotoUrl("p1", "https://images.exemplo.com/a.jpg"), "https://images.exemplo.com/a.jpg");
  assert.equal(mobileCountPhotoUrl("p 1", embedded), "/api/stock/mobile-count/photo?productId=p%201");
  for (const stored of ["", undefined, "http://inseguro.com/a.jpg", "gs://bucket/a.jpg", "data:text/html;base64,PGI+", "data:image/svg+xml;base64,PHN2Zz4="]) {
    assert.equal(mobileCountPhotoUrl("p1", stored), null, String(stored));
  }
  assert.deepEqual(parseProductPhotoDataUri(embedded), { contentType: "image/jpeg", base64: "/9j/4AAQSkZJRg==" });
  assert.equal(parseProductPhotoDataUri("data:image/png;base64,abc def"), null);
  assert.equal(parseProductPhotoDataUri(`data:image/png;base64,${"A".repeat(2_800_000)}`), null);
  assert.equal(mobileCountPhotoQuerySchema.safeParse({ productId: "p1" }).success, true);
  assert.equal(mobileCountPhotoQuerySchema.safeParse({ productId: "a/b" }).success, false);
  assert.equal(mobileCountPhotoQuerySchema.safeParse({ productId: "p1", size: "big" }).success, false);
});

test("cancelling a count is the owner's, only while open, and never touches stock", () => {
  assert.equal(cancelMobileCountSchema.safeParse({ sessionId: "s1" }).success, true);
  assert.equal(cancelMobileCountSchema.safeParse({ sessionId: "s1", force: true }).success, false);
  const rules = readFileSync("src/features/stock-count/mobile-count.server.ts", "utf8");
  const cancel = rules.slice(rules.indexOf("export async function cancelMobileCount"), rules.indexOf("/** Saves the draft"));
  assert.match(cancel, /assertCanPerformMobileCount\(actor\)/);
  assert.match(cancel, /!isStockCountOwner\(actor, session\) \|\| !canAccessUnit\(/);
  assert.match(cancel, /session\.status !== "pending_review"/);
  assert.match(cancel, /transaction\.delete\(reference\)/);
  assert.match(cancel, /cancelStockCountTaskSafely\(/);
  assert.doesNotMatch(cancel, /collection\("lots"\)|completeStockCountSession/);
  for (const name of ["cancel", "photo"]) {
    const route = readFileSync(`src/app/api/stock/mobile-count/${name}/route.ts`, "utf8");
    assert.match(route, /secureRoute\(\{ contract, enforcer \}/);
    assert.match(route, /assertMobileAppAttested\(/);
    assert.match(route, /assertCanPerformMobileCount\(actor\)/);
    assert.match(route, /action: "app\.stock-count\.perform"/);
  }
  // No aplicativo, sair guarda a contagem; só "Cancelar", com confirmação, apaga.
  const screen = readFileSync("apps/coala-notas/src/CountScreen.tsx", "utf8");
  assert.match(screen, /label="Cancelar contagem" onPress=\{\(\) => void cancel\(\)\}/);
  assert.match(screen, /saveCount\(user, session, drafts, false\)\.then\(\(\) => true, \(\) => false\)/);
  assert.doesNotMatch(screen, /Salvar e sair/);
});

test("reopening a count keeps the newer draft: a phone left behind never overwrites another device", () => {
  const server = { a: "servidor-a", b: "servidor-b" };
  const saved = (savedAt: number, drafts: Record<string, string>) => ({ savedAt, drafts });
  const at = (iso: string) => Date.parse(iso);
  const base = { server, knownLotIds: ["a", "b", "c"] };
  // Sem rascunho no aparelho, vale o do sistema.
  assert.deepEqual(chooseCountDrafts({ ...base, serverUpdatedAt: "2026-10-11T10:00:00.000Z", local: null }), { drafts: server, source: "server", discardedLocal: false });
  // Ficou sem internet e voltou no mesmo aparelho: o aparelho é mais novo e vale por cima, lote a lote.
  assert.deepEqual(
    chooseCountDrafts({ ...base, serverUpdatedAt: "2026-10-11T10:00:00.000Z", local: saved(at("2026-10-11T10:05:00.000Z"), { a: "celular-a", c: "celular-c" }) }),
    { drafts: { a: "celular-a", b: "servidor-b", c: "celular-c" }, source: "local", discardedLocal: false },
  );
  // Continuou em outro aparelho depois: o rascunho velho deste celular é descartado.
  assert.deepEqual(
    chooseCountDrafts({ ...base, serverUpdatedAt: "2026-10-11T11:00:00.000Z", local: saved(at("2026-10-11T10:05:00.000Z"), { a: "celular-a" }) }),
    { drafts: server, source: "server", discardedLocal: true },
  );
  // Contagem nunca salva no sistema: só o aparelho tem lançamentos.
  assert.equal(chooseCountDrafts({ ...base, serverUpdatedAt: null, local: saved(0, { a: "celular-a" }) }).source, "local");
  // Rascunho de lote que não existe mais na contagem não conta.
  assert.deepEqual(chooseCountDrafts({ ...base, serverUpdatedAt: null, local: saved(5, { z: "sumiu" }) }), { drafts: server, source: "server", discardedLocal: false });
  const screen = readFileSync("apps/coala-notas/src/CountScreen.tsx", "utf8");
  assert.match(screen, /if \(sent\) await clearLocalDrafts\(session\.id\);/);
  assert.match(readFileSync("src/features/stock-count/mobile-count.server.ts", "utf8"), /updatedAt: typeof \(session as/);
});
