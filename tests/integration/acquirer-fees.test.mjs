import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { Timestamp } = await import("firebase-admin/firestore");
const { AppError } = await import("../../src/lib/observability/app-error.ts");
const { executeFeeAction, listFeeRecords, listFeeCandidates } = await import("../../src/features/financial/acquirer-fees/repository.server.ts");
const { queryFeeEvidence } = await import("../../src/features/financial/acquirer-fees/source.server.ts");
const { reviewPixSnapshot } = await import("../../src/features/financial/sales-reconciliation/pix-source.ts");
const { financialAgentMappingSchema } = await import("../../src/features/financial/agent/contracts.ts");
const { registerReportedPayment, queueMatchedBankPayment } = await import("../../src/features/financial/obligations/service.server.ts");
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

test("Pix concorrente/retry cria uma despesa, sem XML, pagamentos, obrigação ou banco; evento cruza mês", async () => {
  const f = await fixture("concurrent");
  const results = await Promise.all([f.call("create", f.create), f.call("create", f.create)]);
  assert.equal(results[0].record.expenseId, results[1].record.expenseId);
  assert.equal(results.filter(r => r.idempotent).length, 1);
  const ref = db.collection("expenses").doc(results[0].record.expenseId), expense = (await ref.get()).data();
  assert.equal(expense.totalValue, 0.05); assert.equal(expense.status, "paid");
  assert.equal(expense.competenceMonth, "2026-08");
  assert.equal(expense.competenceDate.toDate().toISOString().slice(0, 10), "2026-08-31");
  assert.equal(expense.paidAt.toDate().toISOString().slice(0, 10), "2026-09-01");
  assert.equal(expense.sourceSettlement.kind, "acquirer_fee");
  assert.equal(expense.cashEffectIncludedInNetReceivable, true);
  assert.equal(expense.settlementSummary.balanceAmountCents, 0);
  assert.equal(expense.settlementSummary.confirmedCashAmountCents, 0);
  for (const name of ["payments", "paymentSplits", "transactions", "financialObligations", "bankPaymentRequests"]) {
    assert.equal((await db.collection(name).where("expenseId", "==", ref.id).limit(1).get()).empty, true);
  }
  await assert.rejects(registerReportedPayment(ref.id, { idempotencyKey: "none" }, { uid: prefix }), code("EXPENSE_SETTLED_AT_SOURCE"));
  await assert.rejects(queueMatchedBankPayment({ batch: db.batch(), expenseId: ref.id, expense, bankTransactionId: "none", principalAmount: .05, cashAmount: .05, paidAt: Timestamp.now(), actor: { uid: prefix } }), code("EXPENSE_SETTLED_AT_SOURCE"));
  assert.equal((await listFeeRecords(f.request, context)).records.length, 1);
  assert.equal(f.xmlCalls(), 0);
});

test("MDR soma decimal antes de arredondar, competência anterior, candidato usa dia da competência", async () => {
  const f = await fixture("cards", { cards: true });
  assert.equal(f.batch.amountCents, 1); assert.equal(f.batch.competenceDate, "2026-09-01");
  const manualRef = own(db.collection("expenses").doc(`${prefix}-manual`));
  const dueDate = Timestamp.fromDate(new Date("2026-09-04T12:00:00Z"));
  const original = { obligationId: `obl_${manualRef.id}`, totalValue: .01, description: "Taxas avulsas", status: "pending", paymentMethod: "single",
    competenceMonth: "2026-09", competenceDate: dueDate, dueDate, accountId: f.accountPlanId, accountPlan: f.accountPlanId,
    resultCenterId: f.centerId, installments: [{ number: 1, dueDate, value: .01, status: "pending" }], notes: "Antes" };
  await manualRef.set(original);
  assert.equal((await listFeeCandidates(f.request, f.centerId, undefined, context)).candidates.length, 0);
  assert.equal((await listFeeCandidates({ ...f.request, referenceDate: f.batch.competenceDate }, f.centerId, undefined, context)).candidates[0].id, manualRef.id);
  await assert.rejects(f.call("create", f.create), code("ACQUIRER_FEE_MANUAL_CANDIDATE"));
  const link = { batchId: f.batch.id, fingerprint: f.batch.fingerprint, existingExpenseId: manualRef.id };
  assert.equal((await f.call("link", link)).record.expenseId, manualRef.id);
  assert.equal((await f.call("link", link)).idempotent, true);
  const paid = (await manualRef.get()).data();
  assert.equal(paid.workspaceId, WORKSPACE_ID); assert.equal(paid.installments[0].status, "paid");
  assert.equal(paid.competenceDate.toDate().toISOString().slice(0, 10), f.batch.competenceDate);
  await manualRef.update({ notes: "Nota posterior" });
  await assert.rejects(f.call("cancel", { batchId: f.batch.id }), code("ACQUIRER_FEE_INPUT_INVALID"));
  await f.call("cancel", { batchId: f.batch.id, reason: "Correção de vínculo" });
  const restored = (await manualRef.get()).data();
  assert.equal(restored.workspaceId, undefined); assert.equal(restored.sourceSettlement, undefined);
  assert.equal(restored.status, "pending"); assert.equal(restored.notes, "Nota posterior");
  assert.deepEqual(restored.installments, original.installments); assert.deepEqual(restored.competenceDate, original.competenceDate);
});

test("origem alterada, overlap parcial e correção explícita preservam despesa cancelada e histórico", async () => {
  const f = await fixture("changes");
  const first = await f.call("create", f.create);
  f.rows[0].reviewEvidence.amounts.fee = 6;
  await assert.rejects(f.call("create", f.create), code("ACQUIRER_FEE_STALE_PREVIEW"));
  let fresh = await f.call("preview"), batch = fresh.batches[0];
  await assert.rejects(f.call("create", { ...f.create, fingerprint: batch.fingerprint }), code("ACQUIRER_FEE_SOURCE_CHANGED"));
  f.rows.push({ ...f.rows[0], rowId: "c".repeat(64), reviewEvidence: { ...f.rows[0].reviewEvidence, eventId: "another-event", e2eId: "another-e2e" } });
  f.head.summary.transactionCount = 2;
  fresh = await f.call("preview"); batch = fresh.batches[0];
  await assert.rejects(f.call("create", { ...f.create, batchId: batch.id, fingerprint: batch.fingerprint }), code("ACQUIRER_FEE_OVERLAP"));
  // Correction is possible even when the provider XML/snapshot is now unavailable.
  await f.call("cancel", { batchId: f.batch.id, reason: "Fonte reprocessada" }, { ...f.deps, readPix: async () => { throw new Error("must not query source"); } });
  assert.equal((await db.collection("expenses").doc(first.record.expenseId).get()).data().status, "cancelled");
  const revised = { ...f.create, batchId: batch.id, fingerprint: batch.fingerprint };
  await assert.rejects(f.call("create", revised), code("ACQUIRER_FEE_REASON"));
  const next = await f.call("create", { ...revised, reason: "Nova fonte validada" });
  assert.notEqual(next.record.expenseId, first.record.expenseId);
  const history = await listFeeRecords(f.request, context);
  assert.equal(history.records.filter(r => r.active).length, 1);
  assert.equal(history.records.filter(r => !r.active).length, 1);
});

test("admin não ultrapassa workspace, conta-folha e centro exclusivos; mapping/head revalidam na transação", async () => {
  const f = await fixture("scope");
  await assert.rejects(f.call("create", f.create, f.deps, { ...context, isDefaultAdmin: false }), code("ACQUIRER_FEE_FORBIDDEN"));
  await assert.rejects(f.call("create", f.create, f.deps, { ...context, workspace_id: "foreign" }), code("FINANCIAL_AGENT_MAPPING_SCOPE"));
  await db.collection("resultCenters").doc(f.centerId).update({ unitIds: [f.unit, "another-unit"] });
  await assert.rejects(f.call("create", f.create), code("CASH_WITHDRAWAL_CENTER_INVALID"));
  await db.collection("resultCenters").doc(f.centerId).update({ unitIds: [f.unit] });
  const child = own(db.collection("accounts").doc(`${prefix}-child`)); await child.set({ parentId: f.accountPlanId });
  await assert.rejects(f.call("create", f.create), code("CASH_WITHDRAWAL_ACCOUNT_INVALID"));
  await child.delete();
  const originalMapping = financialAgentMappingSchema.parse((await f.mappingRef.get()).data());
  await f.mappingRef.update({ kioskId: "another-unit" });
  await assert.rejects(f.call("create", f.create, { ...f.deps, readMapping: async () => originalMapping }), code("FINANCIAL_AGENT_MAPPING_REQUIRED"));
  await f.mappingRef.set(originalMapping);
  await f.pixRef.update({ sourceHash: "d".repeat(64) });
  await assert.rejects(f.call("create", f.create), code("ACQUIRER_FEE_SOURCE_CHANGED"));
});

test("correção não sobrescreve alteração financeira de outro fluxo", async () => {
  const f = await fixture("guard");
  const first = await f.call("create", f.create);
  await db.collection("expenses").doc(first.record.expenseId).update({ totalValue: 3 });
  await assert.rejects(f.call("cancel", { batchId: f.batch.id, reason: "Correção" }), code("ACQUIRER_FEE_CHANGED"));
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
