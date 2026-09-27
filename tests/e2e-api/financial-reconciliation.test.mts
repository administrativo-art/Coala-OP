import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-reconciliation";
assertFirestoreEmulatorSafety({ projectId });
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
const { dbAdmin: db, authAdmin: auth } = await import("../../src/lib/firebase-admin");
const { financialDbAdmin: financial } = await import("../../src/lib/firebase-financial-admin");
const { buildCashClosureFromPdv } = await import("../../src/features/financial/cash-closures/build-cash-closure");
const { upsertClosureFromPdv, saveCashClosureDraft, getCashClosure } = await import("../../src/features/financial/cash-closures/repository.server");
const { createCashCountingSession } = await import("../../src/features/financial/cash-counting-sessions/repository.server");
const { stonePixFileId } = await import("../../src/lib/integrations/stone/pix-conciliation");

test("HTTP autenticado: sangria → despesa única → contagem → DRE; Pix retido sem novo débito", { timeout: 240_000 }, async t => {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address(); assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-3000); });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, "exit"); server.kill("SIGTERM");
    const timeout = setTimeout(() => server.kill("SIGKILL"), 5000);
    try { await exited; } finally { clearTimeout(timeout); }
  });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    assert.equal(server.exitCode, null, logs);
    try { const r = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) }); if (r.status === 200) { ready = true; break; } } catch { /* Wait only for this owned server. */ }
    await delay(500);
  }
  assert.ok(ready, logs);
  async function user(uid: string, admin: boolean) {
    await auth.createUser({ uid, email: `${uid}@coala.test`, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin: admin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin: admin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({ username: uid, email: `${uid}@coala.test`, profileId: uid, isActive: true, phone: "5598999999999", birthDate: "1990-01-01", profileCompliance: { status: "complete", policyVersion: 1, missingFields: [], invalidFields: [], evaluatedAt: now, completedAt: now, lastConfirmedAt: now, nextReviewAt: "2099-01-01T00:00:00Z" } });
    const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@coala.test`, password: "test-only-password", returnSecureToken: true }) });
    const credentials = await r.json(); assert.equal(r.status, 200); assert.equal(typeof credentials.idToken, "string"); return credentials.idToken as string;
  }
  const token = await user("reconciliation-admin", true), restricted = await user("reconciliation-restricted", false);
  async function call(path: string, body?: unknown, method = body ? "POST" : "GET", access: string | null = token) {
    const response = await fetch(origin + path, { method, headers: { ...(access ? { Authorization: `Bearer ${access}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    return { status: response.status, data: await response.json() };
  }
  const workspaceId = "coala", kioskId = "api-e2e-unit", date = "2026-08-31";
  const actor = { userId: "reconciliation-admin", userName: "Teste API" };
  await db.collection("kiosks").doc(kioskId).set({ workspaceId, name: "Unidade fictícia", active: true, pdvFilialId: "999" });
  await financial.collection("accounts").doc("api-e2e-account").set({ name: "Limpeza", active: true, isGroup: false, dre_position: "despesas_operacionais", is_dre_account: true });
  await financial.collection("resultCenters").doc("api-e2e-center").set({ name: "Centro exclusivo", active: true, unitIds: [kioskId] });
  const built = buildCashClosureFromPdv([{ codcupom: "api-e2e-coupon", usuariorecebimento_id: "op", dtrecebimento: `${date} 12:00:00`, valortotal: 100, itens: [], formaPgtos: [{ nome: "DINHEIRO", valortotal: 100 }] }], {
    workspaceId, kioskId, kioskName: "Unidade fictícia", pdvFilialId: "999", date,
    cashMovements: [{ id: "api-e2e-withdrawal", identitySource: "provider", kind: "withdrawal", amountCents: 1000, date, occurredAt: `${date}T12:00:00-03:00`, operatorId: "op", terminalId: "terminal", paymentMethodId: "cash", paymentMethodName: "DINHEIRO", isCash: true, cancelled: false }],
  });
  const stored = await upsertClosureFromPdv(built, actor), closureId = stored.closure.id;
  const current = await getCashClosure(closureId); assert.ok(current);
  const session = await createCashCountingSession({ workspaceId, units: [{ id: kioskId, name: "Unidade fictícia" }], actor });
  await saveCashClosureDraft(closureId, [{ id: current.lines[0].id, reportedCents: 8000, countedCents: 8000, note: "Falta registrada", reportedNote: "Falta registrada" }], actor, { editReported: true, editCounted: true, requireCountingSessionForCountedChanges: true, countingSessionId: session.id });
  const path = `/api/financial/cash-closures/${closureId}/withdrawals`;
  assert.equal((await call(path, undefined, "GET", null)).status, 401);
  assert.equal((await call(path, undefined, "GET", restricted)).status, 403);
  const preview = await call(path); assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const source = preview.data.sources[0]; assert.ok(source);
  const finalize = `/api/financial/cash-closures/${closureId}/finalize`, finalBody = { operatorId: "op", countingSessionId: session.id };
  const blocked = await call(finalize, finalBody); assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  const input = { action: "create", sourceId: source.sourceId, fingerprint: source.fingerprint, accountPlanId: "api-e2e-account", resultCenterId: "api-e2e-center", description: "Limpeza" };
  assert.equal((await call(path, input, "PATCH", restricted)).status, 403);
  const first = await call(path, input, "PATCH"), retry = await call(path, input, "PATCH");
  assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(first.data.classification.expenseId, retry.data.classification.expenseId); assert.equal(retry.data.idempotent, true);
  const finalized = await call(finalize, finalBody); assert.equal(finalized.status, 200, JSON.stringify(finalized.data));
  const summary = (await financial.collection("cashClosureMonthlySummaries").doc(`${workspaceId}_${kioskId}_2026_08`).get()).data(); assert.ok(summary);
  assert.equal(summary.dreRevenueTotalCents, 10000); assert.equal(summary.dreCashShortageTotalCents, 1000);
  const expense = (await financial.collection("expenses").doc(first.data.classification.expenseId).get()).data(); assert.ok(expense);
  assert.equal(expense.totalValue, 10); assert.equal(expense.competenceMonth, "2026-08");
  assert.equal(summary.dreRevenueTotalCents - expense.totalValue * 100 - summary.dreCashShortageTotalCents + summary.dreCashSurplusTotalCents, 8000);

  const request = { mappingId: "api-e2e-mapping", kioskId, stoneCode: "123", referenceDate: date, source: "pix" };
  await financial.collection("bankAccounts").doc("api-e2e-bank").set({ workspaceId });
  await financial.collection("stoneMerchantMappings").doc(request.mappingId).set({ id: request.mappingId, workspaceId, kioskId, accountId: "api-e2e-bank", stoneCodes: ["123"], terminalIds: [], status: "active", validFrom: "2026-01-01", validTo: null });
  const document = "12345678000199", sourceHash = "a".repeat(64), file = financial.collection("stonePixConciliationFiles").doc(stonePixFileId(document, date));
  await file.set({ workspaceId, document, referenceDate: date, status: "processed", sourceHash, summary: { transactionCount: 1 } });
  await file.collection("transactions").doc("event").set({ rowId: "b".repeat(64), sourceHash, status: "paid", paymentMethod: "pix", merchantIdentity: { version: 1, status: "identified", stoneCode: "123", terminalSerialNumber: "terminal" }, reviewEvidence: { version: 1, eventId: "api-e2e-event", e2eId: "api-e2e-e2e", refundId: null, createdAtUtc: "2026-09-01T02:59:00Z", providerDateTimeUtc: "2026-09-01T03:01:00Z", eventKind: "payment", amounts: { gross: 1000, paid: 1000, canceled: 0, fee: 5, operation: 1000 }, issues: [], candidateForReview: true } });
  const feePath = "/api/financial/acquirer-fees", feePreview = await call(feePath, { action: "preview", request });
  assert.equal(feePreview.status, 200, JSON.stringify(feePreview.data));
  const fee = feePreview.data.batches[0]; assert.ok(fee, JSON.stringify(feePreview.data));
  const feeInput = { action: "create", request, batchId: fee.id, fingerprint: fee.fingerprint, accountPlanId: "api-e2e-account", resultCenterId: "api-e2e-center", confirmedNoManualExpense: true };
  assert.equal((await call(feePath, feeInput, "POST", restricted)).status, 403);
  const posted = await call(feePath, feeInput), repeated = await call(feePath, feeInput);
  assert.equal(posted.status, 200, JSON.stringify(posted.data)); assert.equal(repeated.status, 200, JSON.stringify(repeated.data));
  assert.equal(posted.data.record.expenseId, repeated.data.record.expenseId);
  const feeExpense = (await financial.collection("expenses").doc(posted.data.record.expenseId).get()).data(); assert.ok(feeExpense);
  assert.equal(feeExpense.competenceMonth, "2026-08"); assert.equal(feeExpense.sourceSettlement.settledOn, "2026-09-01");
  assert.equal(feeExpense.cashEffectIncludedInNetReceivable, true);
  await t.test("HTTP CMV: custo atual → confirmação → congelamento → alteração de vendas → reabertura", async () => {
    const simulationId = "api-cmv-shake", ingredientId = "api-cmv-milk", period = "2026-08";
    const saleRef = db.collection("salesReports").doc("api-cmv-sales");
    const saleItem = { sku: "api-cmv", productName: "Milkshake fictício", simulationId, quantity: 2, unitPrice: 15 };
    await Promise.all([
      db.collection("productSimulations").doc(simulationId).set({ name: "Ficha fictícia", totalCmv: 999 }),
      db.collection("productSimulationItems").doc("api-cmv-random-item").set({ simulationId, baseProductId: ingredientId, quantity: 2, useDefault: true }),
      db.collection("baseProducts").doc(ingredientId).set({ name: "Leite fictício", category: "Volume", unit: "l", initialCostPerUnit: 1, lastEffectivePrice: { pricePerUnit: 3 } }),
      saleRef.set({ kioskId, year: 2026, month: 8, day: 31, createdAt: "2026-08-31T12:00:00Z", items: [saleItem] }),
    ]);
    const sourcePath = `/api/financial/dre/source-data?kioskId=${kioskId}&period=${period}`;
    const cmvPath = "/api/financial/dre/cmv-closure";
    const readCmv = async () => {
      const result = await call(sourcePath);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      return result.data.cmvPeriods[0];
    };
    const makeClose = (view: { revision: number; sourceFingerprint: string }) => ({ action: "close", kioskId, period,
      expectedRevision: view.revision, expectedSourceFingerprint: view.sourceFingerprint, salesReviewed: true });
    let view = await readCmv();
    assert.equal(view.totalCmv, 12); assert.equal(view.status, "open");
    const readerToken = await user("cmv-reader", false);
    await db.collection("profiles").doc("cmv-reader").update({ permissions: { financial: { view: true, dre: true } } });
    await db.collection("users").doc("cmv-reader").update({ unitIds: [kioskId] });
    const readerView = await call(sourcePath, undefined, "GET", readerToken);
    assert.equal(readerView.status, 200, JSON.stringify(readerView.data));
    assert.deepEqual(readerView.data.cmvCapabilities, { canClose: false, canReopen: false });
    assert.equal((await call(cmvPath, makeClose(view), "POST", null)).status, 401);
    assert.equal((await call(cmvPath, makeClose(view), "POST", readerToken)).status, 403);
    assert.equal((await call(cmvPath, { ...makeClose(view), salesReviewed: false })).status, 400);
    const closed = await call(cmvPath, makeClose(view));
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal((await call(cmvPath, makeClose(view))).data.idempotent, true);
    await db.collection("baseProducts").doc(ingredientId).update({ "lastEffectivePrice.pricePerUnit": 5 });
    view = await readCmv();
    assert.equal(view.totalCmv, 12); assert.equal(view.status, "closed"); assert.equal(view.sourceChanged, false);
    await saleRef.update({ items: [{ ...saleItem, quantity: 3 }] });
    view = await readCmv();
    assert.equal(view.totalCmv, 12); assert.equal(view.sourceChanged, true);
    const reopened = await call(cmvPath, { action: "reopen", kioskId, period, expectedRevision: view.revision, reason: "Venda tardia conferida no teste" });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
    view = await readCmv();
    assert.equal(view.status, "open"); assert.equal(view.totalCmv, 30);
    const reclosed = await call(cmvPath, makeClose(view));
    assert.equal(reclosed.status, 200, JSON.stringify(reclosed.data));
    assert.equal((await readCmv()).totalCmv, 30);
    assert.equal(reclosed.data.revision, 3);
  });
  for (const collection of ["payments", "paymentSplits", "transactions", "bankPaymentRequests"]) assert.equal((await financial.collection(collection).limit(1).get()).empty, true);
});
