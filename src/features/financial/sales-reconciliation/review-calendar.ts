import type { DailySalesReviewStatus, DailySalesReviewSummary } from "./review-state";

export type DailySalesCalendarRecord = {
  id: string;
  referenceDate: string;
  status: DailySalesReviewStatus;
  revision: number;
  summary: DailySalesReviewSummary;
  reviewedAt: string;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenedReason: "source_changed" | null;
  snapshotAvailable: boolean;
};

export type SalesReviewCalendarResponse = {
  from: string;
  through: string;
  records: DailySalesCalendarRecord[];
};

export type SalesReviewDayState = DailySalesReviewStatus
  | "reopened"
  | "not_reviewed"
  | "outside_scope"
  | "not_available";

export type SalesReviewCalendarDay = {
  date: string;
  day: number;
  state: SalesReviewDayState;
  record: DailySalesCalendarRecord | null;
};

export type SalesReviewMonth = {
  key: string;
  year: number;
  month: number;
  offset: number;
  days: SalesReviewCalendarDay[];
  counts: Record<SalesReviewDayState, number>;
  reviewedCount: number;
  eligibleCount: number;
  closedPercent: number;
};

const DAY_MS = 86_400_000;

export function addCalendarDays(date: string, amount: number) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function calendarDateRangeDays(from: string, through: string) {
  return Math.floor((Date.parse(`${through}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}

export function previousMonth(date: string) {
  const parsed = new Date(`${date.slice(0, 7)}-01T12:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() - 1);
  const key = parsed.toISOString().slice(0, 7);
  const last = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  return { key, from: `${key}-01`, through: `${key}-${String(last).padStart(2, "0")}` };
}

export function calendarState(record: DailySalesCalendarRecord | undefined) : SalesReviewDayState {
  if (!record) return "not_reviewed";
  if (record.status !== "closed" && record.reopenedAt) return "reopened";
  return record.status;
}

export function buildSalesReviewMonth(input: {
  year: number;
  month: number;
  records: DailySalesCalendarRecord[];
  publishedThrough: string;
  validFrom: string;
  validTo?: string | null;
}): SalesReviewMonth {
  const key = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const count = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const offset = new Date(Date.UTC(input.year, input.month - 1, 1)).getUTCDay();
  const byDate = new Map(input.records.map(record => [record.referenceDate, record]));
  const counts: Record<SalesReviewDayState, number> = {
    closed: 0,
    attention_required: 0,
    awaiting_source: 0,
    reopened: 0,
    not_reviewed: 0,
    outside_scope: 0,
    not_available: 0,
  };
  const days = Array.from({ length: count }, (_, index): SalesReviewCalendarDay => {
    const day = index + 1;
    const date = `${key}-${String(day).padStart(2, "0")}`;
    const record = byDate.get(date) ?? null;
    const outsideScope = date < input.validFrom || (!!input.validTo && date > input.validTo);
    const state = outsideScope ? "outside_scope"
      : date > input.publishedThrough ? "not_available"
        : calendarState(record ?? undefined);
    counts[state]++;
    return { date, day, state, record };
  });
  const eligibleCount = days.filter(day => !["outside_scope", "not_available"].includes(day.state)).length;
  const reviewedCount = days.filter(day => !!day.record && !["outside_scope", "not_available"].includes(day.state)).length;
  return {
    key,
    year: input.year,
    month: input.month,
    offset,
    days,
    counts,
    reviewedCount,
    eligibleCount,
    closedPercent: eligibleCount ? Math.round(counts.closed / eligibleCount * 100) : 0,
  };
}

export function buildSalesReviewYear(input: Omit<Parameters<typeof buildSalesReviewMonth>[0], "month"> & { calendarThrough?: string }) {
  const { calendarThrough, ...monthInput } = input;
  const lastMonth = Number((calendarThrough ?? input.publishedThrough).slice(5, 7));
  return Array.from({ length: lastMonth }, (_, index) => buildSalesReviewMonth({ ...monthInput, month: index + 1 }));
}

export const salesReviewDayLabels: Record<SalesReviewDayState, string> = {
  closed: "Fechado",
  attention_required: "Com divergência",
  awaiting_source: "Aguardando fonte",
  reopened: "Reaberto por informação tardia",
  not_reviewed: "Não verificado",
  outside_scope: "Fora da vigência",
  not_available: "Ainda não disponível",
};
