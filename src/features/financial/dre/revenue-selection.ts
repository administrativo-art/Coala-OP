import { CASH_CLOSURE_DRE_VERSION, isCents } from "../cash-closures/dre-contract";
import { resolvePdvFilialId } from "../../../lib/kiosk-identifiers";
import type { DreClosureUnitMonthSummary, DreSalesUnitMonthSummary } from "./source-data";

export type DreCoverageStatus = "complete" | "incomplete" | "unavailable";

/** Cost-only units do not require a nonexistent PDV source; their expenses remain in the DRE. */
export function dreRevenueUnitIds(
  kiosks: readonly { id: string; pdvFilialId?: string | null }[],
  closures: readonly { kioskId: string }[],
  sales: readonly { kioskId: string }[],
) {
  return [...new Set([
    ...kiosks.filter(kiosk => resolvePdvFilialId(kiosk)).map(kiosk => kiosk.id),
    ...closures.map(row => row.kioskId), ...sales.map(row => row.kioskId),
  ])];
}
export type DreRevenueSelection = {
  revenueCents: number | null;
  cashShortageCents: number | null;
  cashSurplusCents: number | null;
  revenueSource: "cash_closure" | "unavailable";
  revenueCoverage: DreCoverageStatus;
  cashDifferenceCoverage: DreCoverageStatus;
  coveredDates: string[];
  /** Coverage concerns observed source data, never monthly closing/finalization. */
  pendingOperatorCount: number | null;
  issues: string[];
};

/** Unknown units stay unknown: never present a partial company sum as its total. */
export function aggregateDreRevenue(rows: readonly DreRevenueSelection[]) {
  const sum = (key: "revenueCents" | "cashShortageCents" | "cashSurplusCents") => {
    if (!rows.length || rows.some(row => row[key] === null)) return null;
    const total = rows.reduce((value, row) => value + row[key]!, 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  return {
    revenueCents: sum("revenueCents"),
    cashShortageCents: sum("cashShortageCents"),
    cashSurplusCents: sum("cashSurplusCents"),
    pendingOperatorCount: rows.some(row => row.pendingOperatorCount === null)
      ? null : rows.reduce((value, row) => value + row.pendingOperatorCount!, 0),
    issues: [...new Set(rows.flatMap(row => row.issues))],
  };
}

/** Select exactly one unit/month source. Never add overlapping sales reports or infer sales from cash. */
export function selectDreRevenue(input: {
  kioskId: string;
  year: number;
  month: number;
  closureSummaries: readonly DreClosureUnitMonthSummary[];
  salesSummaries: readonly DreSalesUnitMonthSummary[];
}): DreRevenueSelection {
  const matches = (row: { kioskId: string; year: number; month: number }) =>
    row.kioskId === input.kioskId && row.year === input.year && row.month === input.month;
  const rows = input.closureSummaries.filter(matches);
  const sales = input.salesSummaries.filter(row => matches(row) && !row.cmvOnly);
  const result: DreRevenueSelection = {
    revenueCents: null, cashShortageCents: null, cashSurplusCents: null,
    revenueSource: "unavailable", revenueCoverage: "unavailable", cashDifferenceCoverage: "unavailable",
    coveredDates: [], pendingOperatorCount: null, issues: [],
  };
  const finish = () => {
    if (result.revenueCents === null && sales.length) result.issues.push("sales_reports_not_integral_payment_source");
    return result;
  };
  if (rows.length !== 1) {
    result.issues.push(rows.length ? "overlapping_closure_summaries" : "missing_closure_summary");
    return finish();
  }
  const row = rows[0];
  const coverage = row.dreCoverage;
  if (row.dreVersion !== CASH_CLOSURE_DRE_VERSION || !coverage) {
    result.issues.push("legacy_or_unsupported_summary");
    return finish();
  }
  const monthKey = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const maximumDay = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const dates = coverage.dates;
  const validDates = Array.isArray(dates) && dates.length > 0 && dates.length <= maximumDay
    && dates.every(date => typeof date === "string" && date.startsWith(`${monthKey}-`)
      && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(8)) >= 1 && Number(date.slice(8)) <= maximumDay)
    && new Set(dates).size === dates.length
    && coverage.closureCount === dates.length && row.closureCount === dates.length;
  if (!validDates) {
    result.issues.push("invalid_summary_coverage");
    return finish();
  }
  result.coveredDates = [...dates];
  result.pendingOperatorCount = isCents(coverage.pendingOperatorCount) && coverage.pendingOperatorCount >= 0
    ? coverage.pendingOperatorCount : null;
  if (result.pendingOperatorCount === null) result.issues.push("unknown_operator_finalization_coverage");
  else if (result.pendingOperatorCount > 0) result.issues.push("operators_pending_finalization");
  if ((coverage.staleCashDifferenceClosureCount ?? 0) > 0) result.issues.push("pdv_changed_after_approval");
  const knownDaysCovered = dates.length === maximumDay || sales.every(sale => sale.hasUndatedReports === false
    && Array.isArray(sale.dates) && sale.dates.length > 0 && sale.dates.every(date => dates.includes(date)));
  const covers = (covered: string[] | undefined, count: number) => Array.isArray(covered)
    && count === dates.length && covered.length === dates.length
    && new Set(covered).size === covered.length && covered.every(date => dates.includes(date));
  const revenueComplete = knownDaysCovered && covers(coverage.revenueDates, coverage.revenueClosureCount)
    && isCents(row.dreRevenueTotalCents);
  const cashComplete = knownDaysCovered && !(coverage.staleCashDifferenceClosureCount ?? 0)
    && covers(coverage.cashDifferenceDates, coverage.cashDifferenceClosureCount)
    && isCents(row.dreCashShortageTotalCents) && row.dreCashShortageTotalCents >= 0
    && isCents(row.dreCashSurplusTotalCents) && row.dreCashSurplusTotalCents >= 0;
  result.revenueCoverage = revenueComplete ? "complete" : "incomplete";
  result.cashDifferenceCoverage = cashComplete ? "complete" : "incomplete";
  if (!knownDaysCovered) result.issues.push("sales_dates_not_covered");
  if (revenueComplete) {
    result.revenueCents = row.dreRevenueTotalCents!;
    result.revenueSource = "cash_closure";
  } else result.issues.push("incomplete_pdv_revenue");
  if (cashComplete) {
    result.cashShortageCents = row.dreCashShortageTotalCents!;
    result.cashSurplusCents = row.dreCashSurplusTotalCents!;
  } else result.issues.push("incomplete_cash_differences");
  return finish();
}
