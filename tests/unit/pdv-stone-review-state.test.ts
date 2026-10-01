import assert from "node:assert/strict";
import test from "node:test";
import { queryDailySales, type SalesReviewBinding } from "../../src/features/financial/sales-reconciliation/query";
import {
  buildDailySalesReviewTransition,
  dailySalesReviewId,
  dailySalesReviewStatus,
} from "../../src/features/financial/sales-reconciliation/review-state";
import { salesBinding, salesRequest, reviewCoupons, reviewXml } from "../fixtures/pdv-stone-review";

async function result() {
  return queryDailySales(salesRequest, { isDefaultAdmin: true, workspace_id: "coala" }, {
    resolveBinding: async () => structuredClone(salesBinding) as SalesReviewBinding,
    readPdv: async () => structuredClone(reviewCoupons),
    readStone: async () => reviewXml,
    now: () => new Date("2026-09-22T12:00:00Z"),
  });
}

test("a complete comparison is closed once and the same evidence is idempotent", async () => {
  const compared = await result();
  const first = buildDailySalesReviewTransition({ result: compared, actorId: "admin", now: "2026-09-22T12:00:00.000Z" });
  assert.equal(first.write, true);
  assert.equal(first.view.status, "closed");
  assert.equal(first.view.revision, 1);
  assert.equal(first.view.closedAt, "2026-09-22T12:00:00.000Z");
  assert.equal(first.view.sourceChanged, false);
  assert.equal(first.view.id, dailySalesReviewId(compared));
  if (!first.write) assert.fail("first transition must persist");

  const recollected = { ...compared, collectedAt: "2026-09-22T13:00:00.000Z" };
  const second = buildDailySalesReviewTransition({
    result: recollected, actorId: "admin", now: "2026-09-22T13:00:00.000Z", previous: first.next,
  });
  assert.equal(second.write, false);
  assert.equal(second.view.revision, 1);
  assert.equal(second.view.closedAt, first.view.closedAt);
  assert.equal(second.view.checkedAt, "2026-09-22T13:00:00.000Z");
});

test("a late source change reopens a previously closed day only when it creates a real pending case", async () => {
  const compared = await result();
  const closed = buildDailySalesReviewTransition({ result: compared, actorId: "admin", now: "2026-09-22T12:00:00.000Z" });
  if (!closed.write) assert.fail("first transition must persist");
  const changed = structuredClone(compared);
  changed.stoneSales = [];
  changed.cases = changed.cases.map(row => ({ ...row, stoneSaleIds: [], stoneGrossAmountCents: 0,
    differenceAmountCents: -row.pdvGrossAmountCents, kind: "pdv_only" as const,
    matchBasis: "unmatched" as const, confidence: "none" as const, reviewStatus: "attention_required" as const }));
  const reopened = buildDailySalesReviewTransition({
    result: changed, actorId: "admin", now: "2026-09-22T14:00:00.000Z", previous: closed.next,
  });
  assert.equal(reopened.write, true);
  assert.equal(reopened.view.status, "attention_required");
  assert.equal(reopened.view.revision, 2);
  assert.equal(reopened.view.sourceChanged, true);
  assert.equal(reopened.view.closedAt, null);
  assert.equal(reopened.view.reopenedAt, "2026-09-22T14:00:00.000Z");
  assert.equal(reopened.view.reopenedReason, "source_changed");
});

test("an unavailable Pix comparison waits for its persisted source instead of closing", async () => {
  const compared = await result();
  const awaiting = structuredClone(compared);
  awaiting.cases = [];
  awaiting.stoneSales = [];
  awaiting.uncomparedPdvFacts = awaiting.pdvFacts.map(fact => ({ ...fact, channel: "pix" as const }));
  awaiting.pix = { status: "requested", coverage: null, excludedCount: 0, fileId: null };
  assert.equal(dailySalesReviewStatus(awaiting), "awaiting_source");
});
