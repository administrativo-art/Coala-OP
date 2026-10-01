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
