import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDreRevenue, dreRevenueUnitIds, selectDreRevenue } from "../../src/features/financial/dre/revenue-selection";
import { summarizeCashClosureDre } from "../../src/features/financial/cash-closures/dre-contract";
import { summarizeDreSalesReports, type DreClosureUnitMonthSummary, type DreSalesUnitMonthSummary } from "../../src/features/financial/dre/source-data";

const base = { kioskId: "unit", year: 2026, month: 9 };

test("unidades administrativas não invalidam vendas; unidades configuradas ou com fonte continuam exigidas", () => {
  assert.deepEqual(dreRevenueUnitIds([
    { id: "admin" }, { id: "tirirical" }, { id: "new", pdvFilialId: "1" },
  ], [{ kioskId: "historical" }], [{ kioskId: "historical" }, { kioskId: "sales" }]), ["tirirical", "new", "historical", "sales"]);
});

test("company aggregate never turns an unavailable unit into zero and does not net shortages/surpluses", () => {
  const first = select();
  const second = { ...first, cashShortageCents: 0, cashSurplusCents: 300 };
  assert.equal(aggregateDreRevenue([first, second]).revenueCents, 20_000);
  assert.equal(aggregateDreRevenue([first, second]).cashShortageCents, 1_000);
  assert.equal(aggregateDreRevenue([first, second]).cashSurplusCents, 300);
  assert.equal(aggregateDreRevenue([first, select([])]).revenueCents, null);
  assert.equal(aggregateDreRevenue([]).revenueCents, null);
  // Expense withdrawal already categorized once; do not subtract it from sales too.
  assert.equal(first.revenueCents! - 1_000 - first.cashShortageCents! + first.cashSurplusCents!, 8_000);
});
const sales: DreSalesUnitMonthSummary = { ...base, revenue: 999, cmv: 20, dates: ["2026-09-30"], hasUndatedReports: false };
function summary(): DreClosureUnitMonthSummary {
  return { ...base, id: "month", closureCount: 1, expectedTotalCents: 9_000, differenceTotalCents: -1_000,
    ...summarizeCashClosureDre([{ date: "2026-09-30", pdvSales: { version: 1, amountCents: 10_000 },
      finalizedCashDifferences: { version: 1, shortageCents: 1_000, surplusCents: 0 }, operatorCount: 2, finalizedOperatorCount: 1 }]) };
}
function select(closureSummaries = [summary()], salesSummaries = [sales]) {
  return selectDreRevenue({ ...base, closureSummaries, salesSummaries });
}

test("selects one integral source, separate shortage, and warns about open operators without blocking known sales", () => {
  const value = select();
  assert.equal(value.revenueCents, 10_000);
  assert.equal(value.cashShortageCents, 1_000);
  assert.equal(value.cashSurplusCents, 0);
  assert.equal(value.revenueCoverage, "complete");
  assert.equal(value.pendingOperatorCount, 1);
  assert.ok(value.issues.includes("operators_pending_finalization"));
  assert.ok(!value.issues.includes("sales_reports_not_integral_payment_source"));
  assert.deepEqual(value.coveredDates, ["2026-09-30"]);
});

test("missing/legacy/unknown version summaries never use adjusted expected plus differences or item revenue", () => {
  const legacy = summary(); delete legacy.dreVersion;
  for (const summaries of [[], [legacy], [{ ...summary(), dreVersion: 99 as 1 }]]) {
    const value = select(summaries);
    assert.equal(value.revenueCents, null);
    assert.equal(value.cashShortageCents, null);
    assert.equal(value.revenueCoverage, "unavailable");
    assert.ok(value.issues.includes("sales_reports_not_integral_payment_source"));
  }
});

test("missing dates, partial old/new coverage and duplicated summaries cannot masquerade as integral", () => {
  const extraDay = { ...sales, dates: ["2026-09-29", "2026-09-30"] };
  assert.equal(select([summary()], [extraDay]).revenueCents, null);
  assert.equal(select([summary()], [extraDay]).revenueCoverage, "incomplete");
  assert.equal(select([summary()], [{ ...sales, hasUndatedReports: true }]).revenueCents, null);
  assert.equal(select([summary(), summary()]).revenueCents, null);
  const mixed = summary(); mixed.dreCoverage!.revenueClosureCount = 0;
  assert.equal(select([mixed]).revenueCents, null);
  const wrongMonth = summary(); wrongMonth.dreCoverage!.dates = ["2026-10-01"];
  assert.equal(select([wrongMonth]).revenueCents, null);
  const wrongCount = summary(); wrongCount.closureCount = 2;
  assert.equal(select([wrongCount]).revenueCents, null);
});

test("known zero is available, but missing cash coverage and resync stale prevent complete result without hiding sales", () => {
  const row = summary(); row.dreRevenueTotalCents = 0;
  assert.equal(select([row]).revenueCents, 0);
  delete row.dreCashShortageTotalCents;
  assert.equal(select([row]).cashShortageCents, null);
  assert.equal(select([row]).revenueCoverage, "complete");
  const stale = summary(); stale.dreCoverage!.staleCashDifferenceClosureCount = 1;
  const value = select([stale]);
  assert.equal(value.revenueCents, 10_000);
  assert.equal(value.cashShortageCents, null);
  assert.equal(value.cashDifferenceCoverage, "incomplete");
  assert.ok(value.issues.includes("pdv_changed_after_approval"));
});

test("selection isolates unit/month and excludes malformed amounts", () => {
  assert.equal(select([summary(), { ...summary(), kioskId: "foreign" }, { ...summary(), month: 8 }]).revenueCents, 10_000);
  assert.equal(select([{ ...summary(), dreRevenueTotalCents: NaN }]).revenueCents, null);
  assert.equal(select([{ ...summary(), dreCashShortageTotalCents: -100 }]).cashShortageCents, null);
});

test("report aggregation records known dates and identifies undated reports instead of assuming monthly coverage", () => {
  const reports = [{ ...base, id: "dated", day: 30, createdAt: "2026-10-02", items: [] },
    { ...base, id: "undated", createdAt: "2026-10-02", items: [] }];
  const value = summarizeDreSalesReports(reports, new Map()).salesSummaries[0];
  assert.deepEqual(value.dates, ["2026-09-30"]);
  assert.equal(value.hasUndatedReports, true);
  assert.equal(select([summary()], [value]).revenueCents, null);
});
