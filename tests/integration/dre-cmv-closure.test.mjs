import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-coala-repository");
const { dbAdmin: db } = await import("../../src/lib/firebase-admin.ts");
const { defaultAdminPermissions, defaultGuestPermissions } = await import("../../src/types/index.ts");
const { buildCmvPeriod, loadCurrentCompositionCosts, loadCmvClosures, mutateCmvClosure, cmvClosureId, assertCmvActionAccess, CMV_CLOSURE_COLLECTION } = await import("../../src/features/financial/dre/cmv-closure.server.ts");
const { getDreSourceData } = await import("../../src/features/financial/dre/source-data.server.ts");
const actor = { isDefaultAdmin: true, permissions: defaultAdminPermissions, decoded: { uid: "cmv-admin" }, userDoc: { id: "cmv-admin", unitAccessScope: "all" }, workspace_id: "coala" };
const now = new Date("2026-09-27T12:00:00Z");
const kioskId = "cmv-test-unit", period = "2026-08", simulationId = "cmv-test-shake";
const itemId = "random-cmv-item-id", ingredientId = "cmv-test-milk";
const report = { id: "cmv-test-sales", year: 2026, month: 8, day: 1, kioskId, createdAt: now.toISOString(),
  items: [{ sku: "milkshake", productName: "Milkshake", simulationId, quantity: 2, unitPrice: 20 }] };
const reportRef = db.collection("salesReports").doc(report.id);
const simulationRef = db.collection("productSimulations").doc(simulationId);
const itemRef = db.collection("productSimulationItems").doc(itemId);
const ingredientRef = db.collection("baseProducts").doc(ingredientId);
const closureRef = db.collection(CMV_CLOSURE_COLLECTION).doc(cmvClosureId(actor.workspace_id, kioskId, period));
const read = () => getDreSourceData({ workspaceId: actor.workspace_id, kioskIds: [kioskId], periods: [period], canViewExpenseDetails: true });
const closeInput = view => ({ action: "close", kioskId, period, expectedRevision: view.revision,
  expectedSourceFingerprint: view.sourceFingerprint, salesReviewed: true });

test("CMV mensal: custo vigente, snapshot persistente, conflitos, revisão e leitura sem escrita", async t => {
  await Promise.all([reportRef.set(report), simulationRef.set({ totalCmv: 999, name: "Shake" }),
    itemRef.set({ simulationId, baseProductId: ingredientId, quantity: .125, useDefault: true }),
    ingredientRef.set({ name: "Leite", unit: "l", category: "Volume", initialCostPerUnit: 5, lastEffectivePrice: { pricePerUnit: 8 } })]);
  try {
    let view = (await read()).cmvPeriods[0];
    await t.test("ignora totalCmv persistido velho e calcula itens por simulationId aleatório", async () => {
      assert.equal(view.totalCmv, 2); assert.equal(view.complete, true);
      const before = await closureRef.get(); assert.equal(before.exists, false);
      await simulationRef.set({ name: "Ficha sem totalCmv" });
      assert.equal((await read()).cmvPeriods[0].totalCmv, 2);
      assert.equal((await closureRef.get()).exists, false);
    });
    await t.test("mudança de custo entre revisão e confirmação gera conflito e não grava", async () => {
      await ingredientRef.update({ "lastEffectivePrice.pricePerUnit": 12 });
      await assert.rejects(mutateCmvClosure(actor, closeInput(view), now), error => error.code === "DRE_CMV_SOURCE_CONFLICT");
      assert.equal((await closureRef.get()).exists, false);
      view = (await read()).cmvPeriods[0]; assert.equal(view.totalCmv, 3);
    });
    await t.test("duas confirmações iguais concorrem com um snapshot e uma auditoria", async () => {
      const results = await Promise.all([mutateCmvClosure(actor, closeInput(view), now), mutateCmvClosure(actor, closeInput(view), now)]);
      assert.deepEqual(results.map(result => result.idempotent).sort(), [false, true]);
      assert.equal((await closureRef.collection("revisions").get()).size, 1);
      assert.equal((await closureRef.collection("audit").get()).size, 1);
      const snap = (await closureRef.get()).data();
      assert.equal(snap.products[0].composition.lines[0].appliedPrice, 12);
      assert.equal(snap.sales[0].items[0].sku, "milkshake");
      assert.equal(snap.totalCmv, 3); assert.equal(snap.closedBy, actor.decoded.uid);
    });
    await t.test("preço alterado e exclusão de ficha/composição/insumo preservam custo fechado", async () => {
      await ingredientRef.update({ "lastEffectivePrice.pricePerUnit": 90 });
      assert.equal((await read()).cmvPeriods[0].totalCmv, 3);
      await Promise.all([ingredientRef.delete(), itemRef.delete(), simulationRef.delete()]);
      const before = (await closureRef.get()).updateTime;
      const source = await read();
      assert.equal(source.cmvPeriods[0].totalCmv, 3); assert.equal(source.cmvPeriods[0].sourceChanged, false);
      assert.equal(source.stats.simulationDocuments, 0); assert.equal(source.stats.compositionItemDocuments, 0);
      assert.equal(source.stats.ingredientDocuments, 0); assert.deepEqual(source.missingSimulationIds, []);
      assert.equal(source.salesSummaries[0].cmv, 3);
      assert.ok((await closureRef.get()).updateTime.isEqual(before));
    });
    await t.test("alteração de quantidade/mapeamento e remoção integral das vendas sinalizam sem recalcular", async () => {
      await reportRef.update({ items: [{ ...report.items[0], quantity: 3, simulationId: "another" }] });
      let source = await read(); assert.equal(source.cmvPeriods[0].sourceChanged, true); assert.equal(source.cmvPeriods[0].totalCmv, 3);
      await reportRef.delete();
      source = await read(); assert.equal(source.cmvPeriods[0].sourceChanged, true); assert.equal(source.cmvPeriods[0].totalCmv, 3);
      assert.equal(source.salesSummaries[0].cmvOnly, true); assert.equal(source.salesSummaries[0].cmv, 3);
    });
    await t.test("reabertura requer motivo, preserva revisão fechada, rejeita conflito e é idempotente", async () => {
      await assert.rejects(mutateCmvClosure(actor, { action: "reopen", kioskId, period, expectedRevision: 1, reason: "" }, now), error => error.code === "DRE_CMV_INPUT_INVALID");
      await assert.rejects(mutateCmvClosure(actor, { action: "reopen", kioskId, period, expectedRevision: 0, reason: "Revisar vendas" }, now), error => error.code === "DRE_CMV_REVISION_CONFLICT");
      const request = { action: "reopen", kioskId, period, expectedRevision: 1, reason: "Revisar vendas" };
      assert.deepEqual(await mutateCmvClosure(actor, request, now), { status: "open", revision: 2, idempotent: false });
      assert.deepEqual(await mutateCmvClosure(actor, request, now), { status: "open", revision: 2, idempotent: true });
      assert.equal((await closureRef.collection("revisions").doc("1").get()).get("totalCmv"), 3);
      assert.equal((await read()).cmvPeriods[0].complete, false);
    });
    await t.test("bloqueia custo incompleto e mês sem relatórios; recongelamento usa nova revisão", async () => {
      let live = (await read()).cmvPeriods[0];
      assert.equal(live.totalCmv, null); assert.ok(live.diagnostics.includes("no_sales_reports"));
      await assert.rejects(mutateCmvClosure(actor, closeInput(live), now), error => error.code === "DRE_CMV_INCOMPLETE");
      await reportRef.set(report); live = (await read()).cmvPeriods[0];
      await assert.rejects(mutateCmvClosure(actor, closeInput(live), now), error => error.code === "DRE_CMV_INCOMPLETE");
      await simulationRef.set({ name: "Shake" });
      await itemRef.set({ simulationId, baseProductId: ingredientId, quantity: .125, useDefault: false, overrideUnit: "ml", overrideCostPerUnit: .016 });
      await ingredientRef.set({ name: "Leite", unit: "l", category: "Volume", initialCostPerUnit: 5 });
      live = (await read()).cmvPeriods[0]; assert.equal(live.totalCmv, 4);
      assert.deepEqual(await mutateCmvClosure(actor, closeInput(live), now), { status: "closed", revision: 3, idempotent: false });
      assert.equal((await closureRef.collection("revisions").doc("1").get()).get("totalCmv"), 3);
      assert.equal((await closureRef.collection("audit").get()).size, 3);
    });
  } finally { await Promise.all([reportRef.delete(), simulationRef.delete(), itemRef.delete(), ingredientRef.delete(), db.recursiveDelete(closureRef)]); }
});

test("autorizações CMV exigem leitura DRE, ação de aprovação/reabertura e unidade", async () => {
  const input = { action: "close", kioskId, period, expectedRevision: 0, expectedSourceFingerprint: "a".repeat(64), salesReviewed: true };
  const readOnly = structuredClone(defaultGuestPermissions);
  readOnly.financial.view = true; readOnly.financial.dre = true;
  const user = { ...actor, isDefaultAdmin: false, permissions: readOnly, userDoc: { id: "reader", unitAccessScope: "selected", unitAccessUnitIds: [kioskId] } };
  assert.throws(() => assertCmvActionAccess(user, input), error => error.code === "DRE_CMV_FORBIDDEN");
  readOnly.financial.cashClosures.approve = true;
  assert.doesNotThrow(() => assertCmvActionAccess(user, input));
  assert.throws(() => assertCmvActionAccess(user, { ...input, kioskId: "foreign" }), error => error.code === "DRE_CMV_FORBIDDEN");
  assert.throws(() => assertCmvActionAccess(user, { action: "reopen", kioskId, period, expectedRevision: 1, reason: "Revisar vendas" }), error => error.code === "DRE_CMV_FORBIDDEN");
  readOnly.financial.dre = false;
  assert.throws(() => assertCmvActionAccess(user, input), error => error.code === "DRE_CMV_FORBIDDEN");
  await assert.rejects(mutateCmvClosure(actor, { ...input, period: "2026-09" }, now), error => error.code === "DRE_CMV_PERIOD_INVALID");
});

test("fonte live detecta relatório inválido, deduplica fichas e distingue alteração de custo e venda", async () => {
  const loaded = await loadCurrentCompositionCosts(["absent", "absent"]);
  assert.equal(loaded.stats.simulationDocuments, 1);
  assert.equal(loaded.costs.get("absent").complete, false);
  const invalid = buildCmvPeriod(kioskId, period, [{ ...report, items: [null] }], new Map());
  assert.equal(invalid.view.complete, false); assert.equal(invalid.view.totalCmv, null);
  const explicitZero = buildCmvPeriod(kioskId, period, [{ ...report, items: [] }], new Map());
  assert.equal(explicitZero.view.complete, true); assert.equal(explicitZero.view.totalCmv, 0);
  const composition = { complete: true, totalCmv: 1, diagnostics: [], lines: [], formulaVersion: "composition-current-v1" };
  const withEmptyDay = buildCmvPeriod(kioskId, period, [report, { ...report, id: "empty-day", day: 2, items: [] }], new Map([[simulationId, composition]]));
  assert.equal(withEmptyDay.view.complete, true); assert.equal(withEmptyDay.view.totalCmv, 2);
  assert.equal((await loadCmvClosures(actor.workspace_id, ["empty"], [period])).length, 0);
});
