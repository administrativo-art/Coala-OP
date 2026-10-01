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
