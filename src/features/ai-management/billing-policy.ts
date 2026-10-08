import type { BillingAlert } from "@/features/ai-management/types";

export const BILLING_CACHE_MS = 60 * 60 * 1000;
export const MAX_BIGQUERY_BYTES_BILLED = 250_000_000;
export const BIGQUERY_MONTHLY_FREE_BYTES = 1024 ** 4;

function dateOnly(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function belemBillingWindow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const today = dateOnly(year, month, day);
  const currentMonthStart = dateOnly(year, month, 1);
  const previousMonthStart = dateOnly(year, month - 1, 1);
  const last30DaysStart = dateOnly(year, month, day - 29);
  const endExclusive = dateOnly(year, month, day + 1);
  return {
    today,
    currentMonthStart,
    previousMonthStart,
    last30DaysStart,
    queryStart: previousMonthStart < last30DaysStart ? previousMonthStart : last30DaysStart,
    endExclusive,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

export function openAiBillingWindow(now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const previousMonthStart = dateOnly(year, month - 1, 1);
  const currentMonthStart = dateOnly(year, month, 1);
  const last30DaysStart = dateOnly(year, month, day - 29);
  return {
    previousMonthStart,
    currentMonthStart,
    last30DaysStart,
    queryStart: previousMonthStart < last30DaysStart ? previousMonthStart : last30DaysStart,
    endExclusive: dateOnly(year, month, day + 1),
  };
}

export function nextOpenAiPageToken(hasMore: boolean | undefined, nextPage: string | null | undefined, seen: ReadonlySet<string>): string | null {
  if (hasMore !== true) {
    if (nextPage !== null && nextPage !== undefined) throw new Error("A OpenAI retornou um token de página sem indicar mais resultados.");
    return null;
  }
  if (!nextPage) throw new Error("A OpenAI indicou mais resultados sem token de página.");
  if (seen.has(nextPage)) throw new Error("A OpenAI repetiu um token de página.");
  return nextPage;
}

export function positiveFinite(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function maximumBytesBilled(value: unknown): number {
  const configured = positiveFinite(value);
  return configured === null ? MAX_BIGQUERY_BYTES_BILLED : Math.min(Math.max(1, Math.floor(configured)), MAX_BIGQUERY_BYTES_BILLED);
}

export function openAiSpendLimitUsd(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const limit = value as { threshold_amount?: unknown; currency?: unknown; interval?: unknown };
  const cents = positiveFinite(limit.threshold_amount);
  return limit.currency === "USD" && limit.interval === "month" && cents !== null ? cents / 100 : null;
}

export function budgetAlert(spent: number | null, limit: number | null, basis: BillingAlert["basis"]): BillingAlert {
  if (spent === null || limit === null || !Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0) {
    return { level: "unavailable", basis, usedPercent: null };
  }
  const usedPercent = (spent / limit) * 100;
  return {
    level: usedPercent >= 95 ? "critical" : usedPercent >= 80 ? "warning" : "none",
    basis,
    usedPercent: Number(usedPercent.toFixed(2)),
  };
}

export function projectPanelMonthlyBytes(bytesPerQuery: number, now: Date): number | null {
  if (!Number.isSafeInteger(bytesPerQuery) || bytesPerQuery < 0) return null;
  // A date rollover can invalidate an otherwise valid hourly cache entry once per day.
  return bytesPerQuery * 25 * belemBillingWindow(now).daysInMonth;
}

export function dryRunBytes(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

export function queryWithinLimit(estimatedBytes: number | null, maximumBytes: number): boolean {
  return estimatedBytes !== null && Number.isSafeInteger(estimatedBytes) && estimatedBytes >= 0 && estimatedBytes <= maximumBytes;
}

export async function optionalBillingBuckets<T>(load: () => Promise<T[]>): Promise<{ buckets: T[]; failed: boolean }> {
  try {
    return { buckets: await load(), failed: false };
  } catch {
    return { buckets: [], failed: true };
  }
}

export function createHourlyCache<T>(shouldCache: (value: T) => boolean = () => true) {
  let cached: { key: string; value: T; expiresAt: number } | null = null;
  let pending: { key: string; promise: Promise<T> } | null = null;
  return async (key: string, now: Date, load: () => Promise<T>): Promise<T> => {
    const current = now.getTime();
    if (cached?.key === key && current < cached.expiresAt) return cached.value;
    if (pending?.key === key) return pending.promise;
    const promise = load().then((value) => {
      if (pending?.promise === promise && shouldCache(value)) cached = { key, value, expiresAt: current + BILLING_CACHE_MS };
      return value;
    }).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { key, promise };
    return promise;
  };
}
