import assert from "node:assert/strict";
import test from "node:test";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
process.env.STONE_CONCILIATION_DOCUMENT = "12345678000199";
process.env.STONE_PIX_SYNC_START_DATE = "2026-09-30";
process.env.STONE_CONCILIATION_API_KEY = "integration-api-key";

const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { stonePixFileId } = await import("../../src/lib/integrations/stone/pix-conciliation.ts");
const { requestMissingStonePixFiles } = await import(
  "../../src/features/financial/sales-reconciliation/pix-request.server.ts"
);

test("persiste o pedido por data, aguarda o webhook e reaproveita o arquivo processado", async (t) => {
  const document = process.env.STONE_CONCILIATION_DOCUMENT;
  const referenceDate = "2026-09-30";
  const id = stonePixFileId(document, referenceDate);
  const requestRef = db.collection("stonePixConciliationRequests").doc(id);
  const fileRef = db.collection("stonePixConciliationFiles").doc(id);
  await Promise.all([requestRef.delete(), fileRef.delete()]);
  t.after(async () => Promise.all([requestRef.delete(), fileRef.delete()]));

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 202 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const now = new Date("2026-10-01T12:00:00Z");
  assert.deepEqual(await requestMissingStonePixFiles(now), {
    considered: 1, requested: 1, waiting: 0, processed: 0, failed: 0,
  });
  const persistedRequest = (await requestRef.get()).data();
  assert.equal(persistedRequest?.status, "requested");
  assert.equal(persistedRequest?.referenceDate, referenceDate);
  assert.equal(persistedRequest?.workspaceId, WORKSPACE_ID);

  assert.deepEqual(await requestMissingStonePixFiles(now), {
    considered: 1, requested: 0, waiting: 1, processed: 0, failed: 0,
  });
  assert.equal(calls, 1);

  await fileRef.set({
    workspaceId: WORKSPACE_ID,
    document,
    referenceDate,
    status: "processed",
    schemaVersion: 1,
  });
  assert.deepEqual(await requestMissingStonePixFiles(now), {
    considered: 1, requested: 0, waiting: 0, processed: 1, failed: 0,
  });
  assert.equal(calls, 1);
});

test("reemite somente o arquivo legado com hash e vínculo autorizados", async t => {
  const { pixRefundKey } = await import("../../src/lib/integrations/stone/pix-refunds.ts");
  const document = process.env.STONE_CONCILIATION_DOCUMENT;
  const mappingId = "refund-backfill-test";
  const kioskId = "refund-test-unit";
  const stoneCode = "123";
  const now = new Date("2026-10-01T12:00:00Z");
  const from = "2026-09-10";
  const through = "2026-09-12";
  const plannedDates = [from, "2026-09-11", through];
  const baseline = "a".repeat(64);
  const planRef = db.collection("stonePixRefundBackfills").doc(WORKSPACE_ID);
  const mappingRef = db.collection("stoneMerchantMappings").doc(mappingId);
  const allDates = [...plannedDates, "2026-09-30"];
  const fileRefs = allDates.map(date => db.collection("stonePixConciliationFiles").doc(stonePixFileId(document, date)));
  const requestRefs = allDates.map(date => db.collection("stonePixConciliationRequests").doc(stonePixFileId(document, date)));
  t.after(async () => Promise.all([planRef, mappingRef, ...fileRefs, ...requestRefs].map(ref => ref.delete())));
  await mappingRef.set({ workspaceId: WORKSPACE_ID, kioskId, accountId: "account", stoneCodes: [stoneCode],
    terminalIds: [], status: "active", validFrom: from, validTo: null });
  await planRef.set({ version: 1, workspaceId: WORKSPACE_ID, mappingId, kioskId, stoneCode, from, through,
    expiresAt: "2026-10-02T12:00:00Z", documentKey: pixRefundKey(document),
    files: Object.fromEntries(plannedDates.map(date => [date, baseline])) });
  await Promise.all(fileRefs.map((ref, index) => ref.set({
    workspaceId: WORKSPACE_ID, document, referenceDate: allDates[index], status: "processed", schemaVersion: 1,
    sourceHash: index === 1 ? "b".repeat(64) : baseline,
    ...(index === 2 ? { refundLayoutSupported: true } : {}),
  })));
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(new URL(url).pathname.split("/").at(-1));
    return new Response(null, { status: 202 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.deepEqual((await requestMissingStonePixFiles(now)).refundBackfill, {
    considered: 3, requested: 1, waiting: 1, processed: 1, failed: 0,
  });
  assert.deepEqual(calls, [from]);
  assert.deepEqual((await requestMissingStonePixFiles(now)).refundBackfill, {
    considered: 3, requested: 0, waiting: 2, processed: 1, failed: 0,
  });
  assert.deepEqual(calls, [from]);
});
