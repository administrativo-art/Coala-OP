import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesReviewMonth, buildSalesReviewYear, type DailySalesCalendarRecord } from "../../src/features/financial/sales-reconciliation/review-calendar";
import { buildSalesReviewAutomationPlan, initialSalesReviewAutomationState } from "../../src/features/financial/sales-reconciliation/review-automation";

const summary = { pdvAmountCents: 1000, stoneAmountCents: 1000, autoCheckedCount: 1,
  attentionCount: 0, sourceIssueCount: 0, uncomparedPdvCount: 0 };
function record(referenceDate: string, status: DailySalesCalendarRecord["status"], reopenedAt: string | null = null): DailySalesCalendarRecord {
  return { id: referenceDate, referenceDate, status, revision: 1, summary, reviewedAt: `${referenceDate}T12:00:00.000Z`,
    closedAt: status === "closed" ? `${referenceDate}T12:00:00.000Z` : null,
    reopenedAt, reopenedReason: reopenedAt ? "source_changed" : null, snapshotAvailable: true };
}

test("calendar separates closed, pending, late reopening and dates outside the mapping", () => {
  const month = buildSalesReviewMonth({
    year: 2026, month: 1, publishedThrough: "2026-01-05", validFrom: "2026-01-02", validTo: null,
    records: [record("2026-01-02", "closed"), record("2026-01-03", "attention_required", "2026-01-04T10:00:00.000Z"),
      record("2026-01-04", "awaiting_source")],
  });
  assert.equal(month.days[0].state, "outside_scope");
  assert.equal(month.days[1].state, "closed");
  assert.equal(month.days[2].state, "reopened");
  assert.equal(month.days[3].state, "awaiting_source");
  assert.equal(month.days[4].state, "not_reviewed");
  assert.equal(month.days[5].state, "not_available");
  assert.equal(month.reviewedCount, 3);
  assert.equal(month.eligibleCount, 4);
  assert.equal(month.closedPercent, 25);
});

test("year view starts in January and includes the current month before its first day is published", () => {
  const months = buildSalesReviewYear({ year: 2026, records: [], publishedThrough: "2026-09-30",
    calendarThrough: "2026-10-01", validFrom: "2026-01-01" });
  assert.equal(months.length, 10);
  assert.equal(months[0].key, "2026-01");
  assert.equal(months[9].key, "2026-10");
  assert.equal(months[9].days[0].state, "not_available");
});

test("automation prioritizes one recent day and advances a bounded backfill", () => {
  const plan = buildSalesReviewAutomationPlan({
    state: initialSalesReviewAutomationState(2026), currentDate: "2026-10-01", publishedThrough: "2026-09-30",
    validFrom: "2026-01-01", maxDates: 4,
  });
  assert.deepEqual(plan.dates, ["2026-09-30", "2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.equal(plan.nextState.backfillNextDate, "2026-01-04");
  assert.equal(plan.backfillActive, true);
});

test("automation starts a previous-month sweep only after the initial backfill", () => {
  const plan = buildSalesReviewAutomationPlan({
    state: { backfillNextDate: null, maintenanceOffset: 1, lateSweepMonth: null, lateSweepNextDate: null },
    currentDate: "2026-10-02", publishedThrough: "2026-10-01", validFrom: "2026-01-01", maxDates: 3,
  });
  assert.deepEqual(plan.dates, ["2026-09-30", "2026-09-01", "2026-09-02"]);
  assert.equal(plan.nextState.lateSweepMonth, "2026-09");
  assert.equal(plan.nextState.lateSweepNextDate, "2026-09-03");
  assert.equal(plan.lateSweepActive, true);
});

test("automation keeps a forward cursor so every newly published day is reviewed", () => {
  const waiting = buildSalesReviewAutomationPlan({
    state: { backfillNextDate: "2026-10-01", maintenanceOffset: 1, lateSweepMonth: "2026-09", lateSweepNextDate: null },
    currentDate: "2026-10-01", publishedThrough: "2026-09-30", validFrom: "2026-01-01", maxDates: 3,
  });
  assert.equal(waiting.nextState.backfillNextDate, "2026-10-01");
  assert.equal(waiting.backfillActive, false);

  const published = buildSalesReviewAutomationPlan({
    state: waiting.nextState, currentDate: "2026-10-02", publishedThrough: "2026-10-01",
    validFrom: "2026-01-01", maxDates: 3,
  });
  assert.ok(published.dates.includes("2026-10-01"));
  assert.equal(published.nextState.backfillNextDate, "2026-10-02");
});
