import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { queryDailySales } = await import("../../src/features/financial/sales-reconciliation/query.ts");
const { dailySalesReviewId } = await import("../../src/features/financial/sales-reconciliation/review-state.ts");
const { listDailySalesReviewCalendar, readDailySalesReviewSnapshot, saveDailySalesReview,
  SALES_REVIEW_COLLECTION, SALES_REVIEW_SNAPSHOT_COLLECTION } = await import("../../src/features/financial/sales-reconciliation/review-state.server.ts");
const { salesBinding, salesRequest, reviewCoupons, reviewXml } = await import("../fixtures/pdv-stone-review.ts");

const roots = [];
test.after(async () => { for (const ref of roots) await db.recursiveDelete(ref); });

async function fixture(suffix) {
  const binding = structuredClone(salesBinding);
  binding.mapping.id = `${salesBinding.mapping.id}-${suffix}`;
  binding.mapping.kioskId = `${salesBinding.mapping.kioskId}-${suffix}`;
  binding.mapping.accountId = `${salesBinding.mapping.accountId}-${suffix}`;
  const request = { ...salesRequest, mappingId: binding.mapping.id, kioskId: binding.mapping.kioskId };
  const result = await queryDailySales(request, { isDefaultAdmin: true, workspace_id: "coala" }, {
    resolveBinding: async () => structuredClone(binding),
    readPdv: async () => structuredClone(reviewCoupons),
    readStone: async () => reviewXml,
    now: () => new Date("2026-09-22T12:00:00Z"),
  });
  const root = db.collection(SALES_REVIEW_COLLECTION).doc(dailySalesReviewId(result));
  const snapshot = db.collection(SALES_REVIEW_SNAPSHOT_COLLECTION).doc(dailySalesReviewId(result));
  roots.push(root, snapshot);
  return { result, root, snapshot };
}

test("daily review persistence is idempotent and reopens a closed day after changed evidence", async () => {
  const { result, root, snapshot } = await fixture("state");
  const [first, retry] = await Promise.all([
    saveDailySalesReview(result, "admin", new Date("2026-09-22T12:00:00Z")),
    saveDailySalesReview(result, "admin", new Date("2026-09-22T12:01:00Z")),
  ]);
  assert.equal(first.status, "closed");
  assert.equal(retry.status, "closed");
  assert.equal(first.snapshotAvailable, true);
  assert.equal((await root.get()).get("revision"), 1);
  assert.equal((await root.get()).get("snapshotVersion"), 1);
  assert.equal((await snapshot.get()).get("encoding"), "gzip-json");
  assert.equal((await root.collection("revisions").get()).size, 1);
  const identity = { workspaceId: result.scope.workspaceId, kioskId: result.scope.kioskId,
    mappingId: result.mappingId, stoneCode: result.scope.stoneCode, referenceDate: result.scope.referenceDate };
  const stored = await readDailySalesReviewSnapshot(identity);
  assert.equal(stored?.review.status, "closed");
  assert.deepEqual(stored?.cases, result.cases);
  const calendar = await listDailySalesReviewCalendar({ ...identity, from: result.scope.referenceDate, through: result.scope.referenceDate });
  assert.equal(calendar.length, 1);
  assert.equal(calendar[0].snapshotAvailable, true);
  assert.equal(calendar[0].status, "closed");

  const changed = structuredClone(result);
  changed.collectedAt = "2026-09-22T14:00:00.000Z";
  changed.stoneSales = [];
  changed.cases = changed.cases.map(row => ({ ...row, stoneSaleIds: [], stoneGrossAmountCents: 0,
    differenceAmountCents: -row.pdvGrossAmountCents, kind: "pdv_only", matchBasis: "unmatched",
    confidence: "none", reviewStatus: "attention_required" }));
  const reopened = await saveDailySalesReview(changed, "admin", new Date("2026-09-22T14:00:00Z"));
  assert.equal(reopened.status, "attention_required");
  assert.equal(reopened.revision, 2);
  assert.equal(reopened.sourceChanged, true);
  assert.equal(reopened.reopenedReason, "source_changed");
  assert.equal(reopened.snapshotAvailable, true);
  assert.equal((await readDailySalesReviewSnapshot(identity))?.review.status, "attention_required");
  assert.equal((await root.collection("revisions").get()).size, 2);
});

test("an invalid stored review fails closed without overwriting the document", async () => {
  const { result, root } = await fixture("invalid");
  await root.set({ status: "closed", revision: "invalid" });
  await assert.rejects(saveDailySalesReview(result, "admin", new Date("2026-09-22T12:00:00Z")),
    error => error.code === "SALES_REVIEW_STATE_INVALID");
  assert.deepEqual((await root.get()).data(), { status: "closed", revision: "invalid" });
  assert.equal((await root.collection("revisions").get()).empty, true);
});

test("an older concurrent observation cannot overwrite a newer changed source", async () => {
  const { result, root } = await fixture("stale");
  const newest = structuredClone(result);
  newest.collectedAt = "2026-09-22T13:00:00.000Z";
  await saveDailySalesReview(newest, "admin", new Date("2026-09-22T13:00:01Z"));

  const staleChanged = structuredClone(result);
  staleChanged.collectedAt = "2026-09-22T12:00:00.000Z";
  staleChanged.stoneSales = [];
  staleChanged.cases = staleChanged.cases.map(row => ({ ...row, stoneSaleIds: [], stoneGrossAmountCents: 0,
    differenceAmountCents: -row.pdvGrossAmountCents, kind: "pdv_only", matchBasis: "unmatched",
    confidence: "none", reviewStatus: "attention_required" }));
  await assert.rejects(saveDailySalesReview(staleChanged, "admin", new Date("2026-09-22T13:00:02Z")),
    error => error.code === "SALES_REVIEW_STALE_OBSERVATION");
  assert.equal((await root.get()).get("revision"), 1);
  assert.equal((await root.get()).get("status"), "closed");
  assert.equal((await root.collection("revisions").get()).size, 1);
});

test("Pix refund watch reopens a stored case using the exact monthly projection and preserves collection time", async () => {
  const { result, root } = await fixture("refund-watch");
  const { checkSalesPixRefunds } = await import("../../src/features/financial/sales-reconciliation/pix-refund-review.ts");
  const { readPixRefundChecks, writePixRefundProjection } = await import("../../src/features/financial/sales-reconciliation/pix-refunds.server.ts");
  const { refreshDuePixRefundReviews } = await import("../../src/features/financial/sales-reconciliation/pix-refund-automation.server.ts");
  const { salesRefundWatchDates } = await import("../../src/features/financial/sales-reconciliation/review-state.server.ts");
  const { suggestSalesReconciliationCases } = await import("../../src/features/financial/sales-reconciliation/matching.ts");
  const { pixRefundKey, pixRefundMonthId } = await import("../../src/lib/integrations/stone/pix-refunds.ts");
  const document = "12345678901";
  const previousDocument = process.env.STONE_CONCILIATION_DOCUMENT;
  process.env.STONE_CONCILIATION_DOCUMENT = document;
  const e2e = "pix-immutable-id";
  const sourceHash = "a".repeat(64);
  const saleDate = result.scope.referenceDate;
  const later = "2026-09-21";
  const future = "2026-09-22";
  const scope = { ...result.scope, mappingId: result.mappingId };
  const reference = referenceDate => ({ workspaceId: scope.workspaceId, document, referenceDate });
  const write = (referenceDate, day) => db.runTransaction(tx => writePixRefundProjection(tx, reference(referenceDate), day));
  roots.push(db.collection("stonePixRefundMonths").doc(pixRefundMonthId(scope.workspaceId, document, saleDate.slice(0, 7))),
    salesRefundWatchDates(scope).doc(saleDate));
  try {
    await write(saleDate, { sourceHash, complete: true, events: {} });
    await write(later, { sourceHash, complete: true, events: {} });
    const pdvFacts = [{ ...result.pdvFacts[0], channel: "pix", status: "partial_cancellation", identifiers: { nsu: "event-sale" } }];
    const stoneSales = [{ ...result.stoneSales[0], channel: "pix", identifiers: { providerTransactionId: e2e, providerEventId: "event-sale" } }];
    const input = { ...result, pdvFacts, stoneSales, pix: { status: "available", coverage: "complete", excludedCount: 0,
      fileId: "sale-file", sourceHash }, cases: suggestSalesReconciliationCases({ pdvFacts, stoneSales }) };
    const original = { ...input, cases: await checkSalesPixRefunds(input, readPixRefundChecks, { through: saleDate, saleSourceHash: sourceHash }) };
    assert.equal(original.cases[0].pixRefundCheck.state, "clear");
    assert.equal((await saveDailySalesReview(original, "test", new Date("2026-09-22T12:00:00Z"))).status, "closed");
    assert.deepEqual(await refreshDuePixRefundReviews(scope, later, new Date("2026-09-23T12:00:00Z")), { checked: 1, retry: 0 });
    assert.equal((await root.get()).get("revision"), 1, "coverage-only cutoff does not create another revision");

    await write(future, { sourceHash, complete: true, events: {
      [pixRefundKey(e2e)]: [{ stoneCode: scope.stoneCode, referenceDate: future, eventId: "event-refund", refundId: "r1",
        occurredAt: "2026-09-22T13:00:00Z", amountCents: 100, state: "confirmed" }],
    } });
    assert.deepEqual(await refreshDuePixRefundReviews(scope, future, new Date("2026-09-24T12:00:00Z")), { checked: 1, retry: 0 });
    const reopened = await readDailySalesReviewSnapshot(scope);
    assert.equal(reopened.review.status, "attention_required");
    assert.equal(reopened.review.revision, 2);
    assert.equal(reopened.review.reopenedReason, "source_changed");
    assert.equal(reopened.collectedAt, result.collectedAt);
    assert.equal(reopened.cases[0].pixRefundCheck.events[0].refundId, "r1");
    assert.equal((await root.collection("revisions").get()).size, 2);
    await assert.rejects(saveDailySalesReview(original, "stale-test", new Date("2026-09-24T13:00:00Z"), {
      expectedRevision: 1, expectedCollectedAt: original.collectedAt, retainWatch: true,
    }), error => error.code === "SALES_REVIEW_STALE_OBSERVATION");
  } finally {
    if (previousDocument === undefined) delete process.env.STONE_CONCILIATION_DOCUMENT;
    else process.env.STONE_CONCILIATION_DOCUMENT = previousDocument;
  }
});

test("resolução Pix sem vínculo preserva fontes, é idempotente na revisão original e reabre por devolução", async t => {
  const { result, root } = await fixture("unlinked");
  const Papa = (await import("papaparse")).default;
  const { parseStonePixCsv, stonePixFileId } = await import("../../src/lib/integrations/stone/pix-conciliation.ts");
  const { writePixRefundProjection } = await import("../../src/features/financial/sales-reconciliation/pix-refunds.server.ts");
  const { pixRefundKey, pixRefundMonthId } = await import("../../src/lib/integrations/stone/pix-refunds.ts");
  const { readPixSalesSource } = await import("../../src/features/financial/sales-reconciliation/pix-source.server.ts");
  const { resolveUnlinkedPix } = await import("../../src/features/financial/sales-reconciliation/unlinked-resolution.server.ts");
  const { refreshDuePixRefundReviews } = await import("../../src/features/financial/sales-reconciliation/pix-refund-automation.server.ts");
  const { suggestSalesReconciliationCases } = await import("../../src/features/financial/sales-reconciliation/matching.ts");
  const { salesRefundWatchDates } = await import("../../src/features/financial/sales-reconciliation/review-state.server.ts");
  const document = "12345678000199";
  const oldDocument = process.env.STONE_CONCILIATION_DOCUMENT;
  process.env.STONE_CONCILIATION_DOCUMENT = document;
  t.after(() => { if (oldDocument === undefined) delete process.env.STONE_CONCILIATION_DOCUMENT; else process.env.STONE_CONCILIATION_DOCUMENT = oldDocument; });
  const scope = { ...result.scope, mappingId: result.mappingId };
  const e2e = "isolated-pix-payment";
  const hash = "c".repeat(64);
  const file = db.collection("stonePixConciliationFiles").doc(stonePixFileId(document, scope.referenceDate));
  roots.push(file, db.collection("stonePixRefundMonths").doc(pixRefundMonthId(scope.workspaceId, document, "2026-09")),
    salesRefundWatchDates(scope).doc(scope.referenceDate));
  const csv = Papa.unparse([{ id:"isolated-event", amount:"700", status:"paid", payment_method:"pix",
    created_at:"2026-09-20T18:55:47Z", pix_transaction__e2e_id:e2e, pix_transaction__paid_amount:"700",
    pix_transaction__canceled_amount:"0", pix_transaction__fee_amount:"4",
    pix_transaction__additional_data:"[{name=Cliente, value=123}, {name=Terminal, value=TERM-1}]",
    pix_transaction__detail__operation:"pay", pix_transaction__detail__operation_amount:"700",
    pix_transaction__detail__provider_datetime:"2026-09-20T18:55:47Z" }]);
  const parsed = parseStonePixCsv(csv);
  await file.set({ workspaceId:scope.workspaceId, document, referenceDate:scope.referenceDate, schemaVersion:1,
    status:"processed", sourceHash:hash, summary:parsed.summary });
  await file.collection("transactions").doc(parsed.transactions[0].rowId).create({ ...parsed.transactions[0], sourceHash:hash });
  const pix = await readPixSalesSource(scope);
  assert.equal(pix.coverage, "complete");
  const stoneSales = [...result.stoneSales, ...pix.facts];
  const cases = suggestSalesReconciliationCases({ pdvFacts:result.pdvFacts, stoneSales });
  const record = { ...result, stoneSales, cases, pix:{status:pix.status,coverage:pix.coverage,excludedCount:pix.excludedCount,fileId:pix.fileId} };
  const saved = await saveDailySalesReview(record, "test", new Date("2026-09-22T10:00:00Z"));
  const oldFingerprint = (await root.get()).get("sourceFingerprint");
  const candidate = cases.find(row => row.kind === "stone_only");
  assert.equal(saved.status, "attention_required");
  assert.equal(candidate.channel, "pix");
  const binding = { ...salesBinding, mapping:{ ...salesBinding.mapping, id:scope.mappingId,
    kioskId:scope.kioskId, accountId:result.accountId } };
  const input = { kioskId:scope.kioskId, mappingId:scope.mappingId, stoneCode:scope.stoneCode, referenceDate:scope.referenceDate,
    expectedRevision:1, caseKey:candidate.deterministicKey, justification:"Pix aprovado na Stone sem cupom vinculado." };
  const actor = { namespace:"main.users", id:"test-authenticated-admin" };
  const now = new Date("2026-09-22T12:00:00Z");
  await assert.rejects(resolveUnlinkedPix(input, { ...binding, mapping:{...binding.mapping,workspaceId:"another"} }, actor, now),
    error=>error.code==="SALES_REVIEW_UNLINKED_STALE");
  await assert.rejects(resolveUnlinkedPix({ ...input, caseKey:cases.find(row=>row.kind==="matched").deterministicKey }, binding, actor, now),
    error=>error.code==="SALES_REVIEW_UNLINKED_NOT_ELIGIBLE");
  await assert.rejects(resolveUnlinkedPix(input, binding, actor, now),
    error=>error.code==="SALES_REVIEW_UNLINKED_NOT_ELIGIBLE");
  const put = (referenceDate, events={}) => db.runTransaction(tx => writePixRefundProjection(tx,
    {workspaceId:scope.workspaceId, document, referenceDate}, {sourceHash:hash,complete:true,events}));
  await put(scope.referenceDate);
  await put("2026-09-21");
  const [first, retry] = await Promise.all([resolveUnlinkedPix(input,binding,actor,now),resolveUnlinkedPix(input,binding,actor,now)]);
  assert.equal(first.review.revision, 2);
  assert.equal(retry.review.revision, 2);
  assert.equal(first.review.status, "closed");
  assert.equal(first.review.summary.autoCheckedCount, 1);
  assert.equal(first.review.summary.resolvedWithoutLinkCount, 1);
  assert.equal(first.cases.find(row=>row.kind==="stone_only").reviewStatus, "resolved_without_link");
  assert.equal((await root.get()).get("sourceFingerprint"),oldFingerprint);
  assert.deepEqual((await root.collection("revisions").doc("2").get()).get("activeUnlinkedResolutions")[0].actor,actor);
  const audit = db.collection("dailySalesUnlinkedResolutionAudits").doc(`${root.id}-2`);
  const technical = db.collection("dailySalesUnlinkedResolutionAudits").doc(`${root.id}-4`);
  roots.push(audit,technical);
  const { dbAdmin } = await import("../../src/lib/firebase-admin.ts");
  const user = dbAdmin.collection("users").doc(actor.id);
  roots.push(user);
  await user.set({ workspaceId:scope.workspaceId, active:true });
  assert.equal((await audit.get()).get("actorUserId"),actor.id);
  assert.equal((await audit.get()).get("reviewId"),root.id);
  const { collectPersonSource } = await import("../../src/features/privacy/person-inventory.server.ts");
  const admin = { decoded:{uid:"test-privacy-admin"}, userDoc:{unitAccessScope:"all"}, isDefaultAdmin:true,
    workspace_id:scope.workspaceId, permissions:{} };
  const lookup = context => collectPersonSource({ actor:context, sourceId:"daily-sales-unlinked-resolution-actors",
    ref:{namespace:"main.users",id:actor.id}, limit:10 });
  const discovered = await lookup(admin);
  assert.equal(discovered.status,"complete");
  assert.deepEqual(discovered.items.map(item=>[item.id,item.role]),[[audit.id,"actor"]]);
  assert.equal((await lookup({ ...admin, isDefaultAdmin:false,
    permissions:{financial:{view:true,personnelCosts:{view:true}}} })).status,"restricted");

  await assert.rejects(resolveUnlinkedPix(input,binding,{namespace:"main.users",id:"another-user"},now),
    error=>error.code==="SALES_REVIEW_STALE_OBSERVATION");
  await put("2026-09-22");
  assert.deepEqual(await refreshDuePixRefundReviews(scope,"2026-09-22",new Date("2026-09-23T12:00:00Z")), {checked:1,retry:0});
  assert.equal((await root.get()).get("revision"),2);
  await put("2026-09-23", { [pixRefundKey(e2e)]:[{stoneCode:scope.stoneCode,referenceDate:"2026-09-23",
    eventId:"provider-refund",refundId:"refund-2",occurredAt:"2026-09-23T15:00:00Z",amountCents:700,state:"confirmed"}] });
  assert.deepEqual(await refreshDuePixRefundReviews(scope,"2026-09-23",new Date("2026-09-24T12:00:00Z")), {checked:1,retry:0});
  const reopened = await readDailySalesReviewSnapshot(scope);
  assert.equal(reopened.review.status,"attention_required");
  assert.equal(reopened.review.revision,3);
  assert.equal(reopened.review.reopenedReason,"source_changed");
  assert.equal(reopened.cases.find(row=>row.kind==="stone_only").reviewStatus,"attention_required");
  assert.equal((await root.collection("revisions").doc("3").get()).get("invalidatedUnlinkedCases")[0].decidedRevision,2);
  assert.deepEqual((await lookup(admin)).items.map(item=>item.id),[audit.id]);
  await assert.rejects(resolveUnlinkedPix(input,binding,actor,new Date("2026-09-24T12:01:00Z")),
    error=>error.code==="SALES_REVIEW_STALE_OBSERVATION");
  await put("2026-09-23");
  const systemActor={namespace:"system",id:actor.id,authorizationReference:"test-operated-resolution"};
  await resolveUnlinkedPix({...input,expectedRevision:3},binding,systemActor,new Date("2026-09-24T12:02:00Z"));
  assert.deepEqual((await technical.get()).get("actor"),systemActor);
  assert.equal((await technical.get()).get("actorUserId"),undefined);
  assert.deepEqual((await lookup(admin)).items.map(item=>item.id),[audit.id]);
  const unmatched = { ...record.pdvFacts[0], id:"other-pdv-fact", grossAmountCents:811, soldAt:"2026-09-20T09:01:00-03:00" };
  const withOtherPdv = [...record.pdvFacts, unmatched];
  const independent = await saveDailySalesReview({...record, pdvFacts:withOtherPdv,
    cases:suggestSalesReconciliationCases({pdvFacts:withOtherPdv,stoneSales}), collectedAt:"2026-09-24T12:03:00Z"},
    "test",new Date("2026-09-24T12:03:00Z"));
  assert.equal(independent.status,"attention_required");
  assert.equal(independent.summary.resolvedWithoutLinkCount,1);
  assert.equal(independent.summary.attentionCount,1);
  assert.equal((await readDailySalesReviewSnapshot(scope)).cases.find(c=>c.kind==="pdv_only").reviewStatus,"attention_required");
});
