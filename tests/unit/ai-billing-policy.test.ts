import assert from "node:assert/strict";
import test from "node:test";

import {
  BIGQUERY_MONTHLY_FREE_BYTES,
  BILLING_CACHE_MS,
  MAX_BIGQUERY_BYTES_BILLED,
  belemBillingWindow,
  budgetAlert,
  createHourlyCache,
  dryRunBytes,
  maximumBytesBilled,
  nextOpenAiPageToken,
  openAiBillingWindow,
  openAiSpendLimitUsd,
  optionalBillingBuckets,
  positiveFinite,
  projectPanelMonthlyBytes,
  queryWithinLimit,
} from "../../src/features/ai-management/billing-policy";

test("OpenAI budget rejects invalid values and converts official cents to USD", () => {
  assert.equal(positiveFinite("0"), null);
  assert.equal(positiveFinite("Infinity"), null);
  assert.equal(positiveFinite("not a number"), null);
  assert.equal(openAiSpendLimitUsd({ threshold_amount: 10000, currency: "USD", interval: "month" }), 100);
  assert.equal(openAiSpendLimitUsd({ threshold_amount: 10000, currency: "EUR", interval: "month" }), null);
  assert.equal(openAiSpendLimitUsd({ threshold_amount: 10000, currency: "USD", interval: "day" }), null);
});

test("budget alerts use 80 and 95 percent without hiding an overrun", () => {
  assert.deepEqual(budgetAlert(79.99, 100, "openai_budget"), { level: "none", basis: "openai_budget", usedPercent: 79.99 });
  assert.equal(budgetAlert(80, 100, "openai_budget").level, "warning");
  assert.equal(budgetAlert(95, 100, "openai_budget").level, "critical");
  assert.equal(budgetAlert(110, 100, "openai_budget").usedPercent, 110);
  assert.equal(budgetAlert(10, null, "openai_budget").level, "unavailable");
});

test("BigQuery limit cannot be raised by environment and monthly estimate only covers hourly panel queries", () => {
  assert.equal(maximumBytesBilled(undefined), MAX_BIGQUERY_BYTES_BILLED);
  assert.equal(maximumBytesBilled("999999999999"), MAX_BIGQUERY_BYTES_BILLED);
  assert.equal(maximumBytesBilled("50000000"), 50_000_000);
  const estimate = projectPanelMonthlyBytes(MAX_BIGQUERY_BYTES_BILLED, new Date("2026-10-08T12:00:00Z"));
  assert.equal(estimate, MAX_BIGQUERY_BYTES_BILLED * 25 * 31);
  assert.ok(estimate! < BIGQUERY_MONTHLY_FREE_BYTES * 0.8);
  assert.equal(dryRunBytes("0"), 0);
  assert.equal(dryRunBytes("250000001"), 250_000_001);
  assert.equal(dryRunBytes(""), null);
  assert.equal(dryRunBytes("9007199254740993"), null);
  assert.equal(queryWithinLimit(null, MAX_BIGQUERY_BYTES_BILLED), false);
  assert.equal(queryWithinLimit(-1, MAX_BIGQUERY_BYTES_BILLED), false);
  assert.equal(queryWithinLimit(MAX_BIGQUERY_BYTES_BILLED, MAX_BIGQUERY_BYTES_BILLED), true);
  assert.equal(queryWithinLimit(MAX_BIGQUERY_BYTES_BILLED + 1, MAX_BIGQUERY_BYTES_BILLED), false);
});

test("Google billing month and last 30 calendar days follow America/Belem at UTC rollover", () => {
  const before = belemBillingWindow(new Date("2026-10-01T02:59:59Z"));
  assert.deepEqual({
    today: before.today,
    current: before.currentMonthStart,
    previous: before.previousMonthStart,
    last30: before.last30DaysStart,
    queryStart: before.queryStart,
    end: before.endExclusive,
  }, {
    today: "2026-09-30",
    current: "2026-09-01",
    previous: "2026-08-01",
    last30: "2026-09-01",
    queryStart: "2026-08-01",
    end: "2026-10-01",
  });
  assert.equal(projectPanelMonthlyBytes(1, new Date("2026-03-01T02:00:00Z")), 25 * 28);

  const after = belemBillingWindow(new Date("2026-10-01T03:00:00Z"));
  assert.equal(after.today, "2026-10-01");
  assert.equal(after.currentMonthStart, "2026-10-01");
  assert.equal(after.previousMonthStart, "2026-09-01");
  assert.equal(after.last30DaysStart, "2026-09-02");
  assert.equal(after.endExclusive, "2026-10-02");
  const march = belemBillingWindow(new Date("2026-03-01T13:00:00Z"));
  assert.equal(march.last30DaysStart, "2026-01-31");
  assert.equal(march.queryStart, "2026-01-31");
});

test("OpenAI includes every UTC day of last 30 days when February is shorter", () => {
  const march = openAiBillingWindow(new Date("2026-03-01T01:00:00Z"));
  assert.equal(march.previousMonthStart, "2026-02-01");
  assert.equal(march.last30DaysStart, "2026-01-31");
  assert.equal(march.queryStart, "2026-01-31");
  assert.equal(march.endExclusive, "2026-03-02");
  const before = openAiBillingWindow(new Date("2026-02-28T23:59:59Z"));
  assert.equal(before.currentMonthStart, "2026-02-01");
  assert.equal(before.endExclusive, "2026-03-01");
});

test("OpenAI pagination fails closed on inconsistent, missing or repeated continuation token", () => {
  assert.equal(nextOpenAiPageToken(false, null, new Set()), null);
  assert.equal(nextOpenAiPageToken(undefined, undefined, new Set()), null);
  assert.equal(nextOpenAiPageToken(true, "next", new Set()), "next");
  assert.throws(() => nextOpenAiPageToken(false, "next", new Set()), /sem indicar mais resultados/);
  assert.throws(() => nextOpenAiPageToken(undefined, "next", new Set()), /sem indicar mais resultados/);
  assert.throws(() => nextOpenAiPageToken(false, "", new Set()), /sem indicar mais resultados/);
  assert.throws(() => nextOpenAiPageToken(true, null, new Set()), /sem token/);
  assert.throws(() => nextOpenAiPageToken(true, "next", new Set(["next"])), /repetiu/);
});

test("optional OpenAI key detail failure does not affect the primary result", async () => {
  const [primaryTotal, detail] = await Promise.all([
    Promise.resolve(12.5),
    optionalBillingBuckets(async () => { throw new Error("provider failure"); }),
  ]);
  assert.deepEqual(detail, { buckets: [], failed: true });
  assert.equal(primaryTotal, 12.5);
  assert.deepEqual(await optionalBillingBuckets(async () => [{ api_key_id: "key_1" }]), {
    buckets: [{ api_key_id: "key_1" }], failed: false,
  });
});

test("hourly cache coalesces concurrent requests and refreshes after expiry or config change", async () => {
  const cache = createHourlyCache<number>();
  const now = new Date("2026-10-08T12:00:00Z");
  let loads = 0;
  const load = async () => { loads += 1; await Promise.resolve(); return loads; };
  assert.deepEqual(await Promise.all([cache("same", now, load), cache("same", now, load)]), [1, 1]);
  assert.equal(await cache("same", new Date(now.getTime() + BILLING_CACHE_MS - 1), load), 1);
  assert.equal(await cache("same", new Date(now.getTime() + BILLING_CACHE_MS), load), 2);
  assert.equal(await cache("changed", now, load), 3);
});

test("stale in-flight result cannot replace a newer configuration", async () => {
  const cache = createHourlyCache<number>();
  const now = new Date("2026-10-08T12:00:00Z");
  let finishOld!: (value: number) => void;
  const old = cache("old", now, () => new Promise<number>((resolve) => { finishOld = resolve; }));
  assert.equal(await cache("new", now, async () => 2), 2);
  finishOld(1);
  assert.equal(await old, 1);
  assert.equal(await cache("new", now, async () => 3), 2);
});

test("hourly cache retries disconnected overviews but retains connected ones", async () => {
  const cache = createHourlyCache<{ connected: boolean; attempt: number }>((value) => value.connected);
  const now = new Date("2026-10-08T12:00:00Z");
  let attempt = 0;
  const load = async () => ({ connected: ++attempt >= 2, attempt });
  assert.deepEqual(await cache("scope", now, load), { connected: false, attempt: 1 });
  assert.deepEqual(await cache("scope", now, load), { connected: true, attempt: 2 });
  assert.deepEqual(await cache("scope", now, load), { connected: true, attempt: 2 });
});

test("cache keys can invalidate at UTC and Belem date rollovers", async () => {
  const googleCache = createHourlyCache<number>();
  const openAiCache = createHourlyCache<number>();
  const utcBefore = new Date("2026-10-01T02:59:59Z");
  const utcAfter = new Date("2026-10-01T03:00:00Z");
  let calls = 0;
  const keyForGoogle = (now: Date) => {
    const window = belemBillingWindow(now);
    return JSON.stringify([window.queryStart, window.endExclusive]);
  };
  assert.equal(await googleCache(keyForGoogle(utcBefore), utcBefore, async () => ++calls), 1);
  assert.equal(await googleCache(keyForGoogle(utcAfter), utcAfter, async () => ++calls), 2);
  const openAiBefore = new Date("2026-09-30T23:59:59Z");
  const openAiAfter = new Date("2026-10-01T00:00:00Z");
  const keyForOpenAi = (now: Date) => {
    const window = openAiBillingWindow(now);
    return JSON.stringify([window.queryStart, window.endExclusive]);
  };
  assert.equal(await openAiCache(keyForOpenAi(openAiBefore), openAiBefore, async () => ++calls), 3);
  assert.equal(await openAiCache(keyForOpenAi(openAiAfter), openAiAfter, async () => ++calls), 4);
});
