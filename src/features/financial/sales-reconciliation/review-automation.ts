import { addCalendarDays, previousMonth } from "./review-calendar";

export type SalesReviewAutomationState = {
  backfillNextDate: string | null;
  maintenanceOffset: number;
  lateSweepMonth: string | null;
  lateSweepNextDate: string | null;
};

export type SalesReviewAutomationPlan = {
  dates: string[];
  nextState: SalesReviewAutomationState;
  backfillActive: boolean;
  lateSweepActive: boolean;
};

const later = (left: string, right: string) => left > right ? left : right;

export function initialSalesReviewAutomationState(year: number): SalesReviewAutomationState {
  return { backfillNextDate: `${year}-01-01`, maintenanceOffset: 0, lateSweepMonth: null, lateSweepNextDate: null };
}

export function buildSalesReviewAutomationPlan(input: {
  state: SalesReviewAutomationState;
  publishedThrough: string;
  validFrom: string;
  validTo?: string | null;
  maxDates?: number;
  currentDate: string;
}): SalesReviewAutomationPlan {
  const maxDates = Math.max(1, Math.min(input.maxDates ?? 6, 10));
  const yearStart = `${input.currentDate.slice(0, 4)}-01-01`;
  const lower = later(yearStart, input.validFrom);
  const upper = input.validTo && input.validTo < input.publishedThrough ? input.validTo : input.publishedThrough;
  if (lower > upper) return { dates: [], nextState: { ...input.state }, backfillActive: false, lateSweepActive: false };

  const recentDate = addCalendarDays(input.publishedThrough, -(input.state.maintenanceOffset % 7));
  const dates = recentDate >= lower && recentDate <= upper ? [recentDate] : [];
  // A completed cursor waits one day beyond the published boundary. This makes every
  // newly published date eligible on the next run, even when scope rotation is slow.
  let backfillNextDate = input.state.backfillNextDate
    ? later(input.state.backfillNextDate, lower)
    : addCalendarDays(upper, 1);
  let lateSweepMonth = input.state.lateSweepMonth;
  let lateSweepNextDate = input.state.lateSweepNextDate;

  while (backfillNextDate <= upper && dates.length < maxDates) {
    if (!dates.includes(backfillNextDate)) dates.push(backfillNextDate);
    backfillNextDate = addCalendarDays(backfillNextDate, 1);
  }
  const backfillActive = backfillNextDate <= upper;

  const dayOfMonth = Number(input.currentDate.slice(8, 10));
  const previous = previousMonth(input.currentDate);
  if (!backfillActive && dayOfMonth <= 7 && lateSweepMonth !== previous.key) {
    lateSweepMonth = previous.key;
    lateSweepNextDate = later(previous.from, lower);
  }
  const lateUpper = previous.through < upper ? previous.through : upper;
  while (!backfillActive && lateSweepNextDate && lateSweepNextDate <= lateUpper && dates.length < maxDates) {
    if (!dates.includes(lateSweepNextDate)) dates.push(lateSweepNextDate);
    lateSweepNextDate = addCalendarDays(lateSweepNextDate, 1);
  }
  if (lateSweepNextDate && lateSweepNextDate > lateUpper) lateSweepNextDate = null;

  return {
    dates,
    nextState: {
      backfillNextDate,
      maintenanceOffset: (input.state.maintenanceOffset + 1) % 7,
      lateSweepMonth,
      lateSweepNextDate,
    },
    backfillActive,
    lateSweepActive: lateSweepNextDate !== null,
  };
}
