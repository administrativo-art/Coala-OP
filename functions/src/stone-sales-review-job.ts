import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const syncSecret = defineSecret("STONE_PORTFOLIO_SYNC_SECRET");
const reviewUrl = defineString("STONE_SALES_REVIEW_URL", {
  default: "https://op.coalashakes.com/api/jobs/stone-sales-review/reconcile",
});

/** Bounded rolling review: recent dates first, then the current-year backfill and late monthly sweep. */
export const stoneSalesReviewScheduler = onSchedule({
  schedule: "30 6-22/2 * * *",
  timeZone: "America/Belem",
  retryCount: 2,
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [syncSecret],
}, async () => {
  const targetUrl = reviewUrl.value().trim();
  if (!targetUrl.startsWith("https://")) throw new Error("Configure STONE_SALES_REVIEW_URL com a URL HTTPS da aplicação.");
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${syncSecret.value().trim()}` },
    signal: AbortSignal.timeout(500_000),
  });
  if (!response.ok) throw new Error(`Stone sales review returned HTTP ${response.status}`);
  const result = await response.json() as { consideredScopes?: number; processedDates?: string[]; backfillActive?: boolean };
  console.log("[stoneSalesReviewScheduler] completed", {
    consideredScopes: result.consideredScopes ?? 0,
    processedDates: result.processedDates?.length ?? 0,
    backfillActive: result.backfillActive ?? false,
  });
});
