import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { AppError } = await import("../../src/lib/observability/app-error.ts");
const { executeFeeAction, listFeeRecords, listFeeCandidates } = await import("../../src/features/financial/acquirer-fees/repository.server.ts");
const { queryFeeEvidence } = await import("../../src/features/financial/acquirer-fees/source.server.ts");
const { reviewPixSnapshot } = await import("../../src/features/financial/sales-reconciliation/pix-source.ts");
const { financialAgentMappingSchema } = await import("../../src/features/financial/agent/contracts.ts");
const { cardXml } = await import("../helpers/acquirer-fee-fixtures.ts");

const prefix = "acquirer-fee-integration";
const context = { isDefaultAdmin: true, workspace_id: WORKSPACE_ID, decoded: { uid: prefix } };
const refs = new Map();
const own = ref => { refs.set(ref.path, ref); return ref; };
const code = expected => error => error.code === expected;
test.after(async () => { for (const ref of refs.values()) await db.recursiveDelete(ref); });

async function fixture(suffix, { cards = false } = {}) {
  const id = `${prefix}-${suffix}`, unit = `${id}-unit`, centerId = `${id}-center`, accountPlanId = `${id}-account`;
  // Sequential cases use distinct merchants, so previous fixtures never make a mapping ambiguous.
  const merchant = String(1000 + refs.size);
  const request = { mappingId: id, kioskId: unit, stoneCode: merchant, referenceDate: cards ? "2026-10-01" : "2026-08-31", source: cards ? "cards" : "pix" };
  const mappingRef = own(db.collection("stoneMerchantMappings").doc(id));
  const mapping = { id, workspaceId: WORKSPACE_ID, kioskId: unit, accountId: `${id}-bank`, stoneCodes: [merchant], terminalIds: [], status: "active", validFrom: "2026-01-01", validTo: null };
  await mappingRef.set(mapping);
  await own(db.collection("bankAccounts").doc(mapping.accountId)).set({ workspaceId: WORKSPACE_ID });
  await own(db.collection("accounts").doc(accountPlanId)).set({ active: true, name: "Taxas", dre_position: "despesas_financeiras", is_dre_account: true, isGroup: false });
  await own(db.collection("resultCenters").doc(centerId)).set({ active: true, name: id, unitIds: [unit] });
  const pixRef = own(db.collection("stonePixConciliationFiles").doc(`${id}-pix`));
  const head = { workspaceId: WORKSPACE_ID, document: "12345678000199", referenceDate: request.referenceDate, status: "processed", schemaVersion: 1, sourceHash: "a".repeat(64), summary: { transactionCount: 1 } };
  await pixRef.set(head);
  const scope = { workspaceId: WORKSPACE_ID, kioskId: unit, stoneCode: merchant, referenceDate: request.referenceDate };
  const rows = [{ rowId: "b".repeat(64), sourceHash: head.sourceHash, status: "paid", paymentMethod: "pix",
    merchantIdentity: { version: 1, status: "identified", stoneCode: merchant, terminalSerialNumber: "terminal" },
    reviewEvidence: { version: 1, eventId: `${id}-event`, e2eId: `${id}-e2e`, refundId: null,
      createdAtUtc: "2026-09-01T02:59:00Z", providerDateTimeUtc: "2026-09-01T03:01:00Z", eventKind: "payment",
      amounts: { gross: 1000, paid: 1000, canceled: 0, fee: 5, operation: 1000 }, issues: [], candidateForReview: true } }];
  let xmlCalls = 0;
  const deps = { now: () => new Date("2026-10-03T12:00:00Z"),
    readMapping: async () => financialAgentMappingSchema.parse((await mappingRef.get()).data()),
    readPix: async () => reviewPixSnapshot({ head, rows, document: head.document, fileId: pixRef.id, scope, now: new Date("2026-10-03T12:00:00Z") }),
    readStone: async ({ referenceDate }) => {
      xmlCalls++;
      assert.ok(cards, "Pix não consulta XML/credencial Stone");
      return cardXml(referenceDate, referenceDate === request.referenceDate).replace("<StoneCode>123</StoneCode>", `<StoneCode>${merchant}</StoneCode>`);
    } };
  const call = async (action, overrides = {}, dependencies = deps, ctx = context) => {
    const result = await executeFeeAction({ action, request, ...overrides }, ctx, dependencies);
    if (result.record) {
      own(db.collection("expenses").doc(result.record.expenseId));
      own(db.collection("financialAcquirerFeeBatches").doc(result.record.id));
      const record = (await db.collection("financialAcquirerFeeBatches").doc(result.record.id).get()).data();
      for (const member of record.batch.members) own(db.collection("financialSourceSettlements").doc(member.id));
    }
    return result;
  };
  const preview = await call("preview"), batch = preview.batches[0];
  assert.ok(batch);
  const create = { batchId: batch.id, fingerprint: batch.fingerprint, accountPlanId, resultCenterId: centerId, confirmedNoManualExpense: true };
  return { call, create, batch, preview, request, deps, mappingRef, pixRef, rows, head, unit, centerId, accountPlanId, xmlCalls: () => xmlCalls };
}

test("prévia e candidatos legados permanecem consultáveis; nova criação/vínculo requer venda conciliada", async () => {
 const f = await fixture("legacy-guard");
 assert.ok(f.preview.batches.length);
 await assert.rejects(f.call("create", f.create), code("ACQUIRER_FEE_RECOGNITION_REQUIRED"));
 await assert.rejects(f.call("link", { batchId:f.batch.id, fingerprint:f.batch.fingerprint, existingExpenseId:"manual" }), code("ACQUIRER_FEE_RECOGNITION_REQUIRED"));
 assert.equal((await listFeeRecords(f.request, context)).records.length,0);
 assert.equal((await listFeeCandidates(f.request,f.centerId,undefined,context)).candidates.length,0);
});

test("origem Stone 404 real fica pendente; inesperados não são engolidos; teto antes de buscar origens", async () => {
  const f = await fixture("transport", { cards: true });
  const source = f.deps.readStone;
  const missing = { ...f.deps, readStone: async query => {
    if (query.referenceDate !== f.request.referenceDate) throw new AppError({ code: "STONE_AGENDA_UPSTREAM_REJECTED", kind: "TRANSIENT_EXTERNAL" });
    return source(query);
  } };
  const pending = await queryFeeEvidence(f.request, context, missing);
  assert.equal(pending.batches.length, 0); assert.ok(pending.pending.some(text => text.includes("indisponível")));
  await assert.rejects(queryFeeEvidence(f.request, context, { ...missing, readStone: async () => { throw new Error("unexpected failure"); } }), /unexpected failure/);
  let reads = 0;
  await assert.rejects(queryFeeEvidence(f.request, context, { ...f.deps, readStone: async () => {
    reads++;
    return cardXml(f.request.referenceDate, true, Array(501).fill("0.1")).replace("<StoneCode>123</StoneCode>", `<StoneCode>${f.request.stoneCode}</StoneCode>`);
  } }), code("ACQUIRER_FEE_SOURCE_LIMIT"));
  assert.equal(reads, 1);
});
