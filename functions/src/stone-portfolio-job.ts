import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const syncSecret = defineSecret("STONE_PORTFOLIO_SYNC_SECRET");
const syncUrl = defineString("STONE_PORTFOLIO_SYNC_URL");

/** Stone publishes the previous civil day's file after 05:00 Brasília time. */
export const stonePortfolioDailySync = onSchedule({
  schedule: "0 6 * * *",
  timeZone: "America/Sao_Paulo",
  retryCount: 1,
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [syncSecret],
}, async () => {
  const response = await fetch(syncUrl.value(), {
    method: "POST",
    headers: { Authorization: `Bearer ${syncSecret.value()}` },
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Stone portfolio sync returned HTTP ${response.status}`);
  const result = await response.json() as { processed?: number };
  console.log("[stonePortfolioDailySync] completed", { processed: result.processed ?? 0 });
});
