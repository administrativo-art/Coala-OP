import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const syncSecret = defineSecret("STONE_PORTFOLIO_SYNC_SECRET");
const requestUrl = defineString("STONE_PIX_REQUEST_URL", {
  default: "https://op.coalashakes.com/api/jobs/stone-pix/request",
});
/** Pix files must be requested after 03:00 for the previous civil day. */
export const stonePixDailyRequest = onSchedule({
  schedule: "10 4 * * *",
  timeZone: "America/Sao_Paulo",
  retryCount: 2,
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [syncSecret],
}, async () => {
  const targetUrl = requestUrl.value().trim();
  if (!targetUrl.startsWith("https://")) {
    throw new Error("Configure STONE_PIX_REQUEST_URL com a URL HTTPS da aplicação.");
  }
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${syncSecret.value().trim()}` },
    signal: AbortSignal.timeout(480_000),
  });
  if (!response.ok) throw new Error(`Stone Pix request returned HTTP ${response.status}`);
  const result = await response.json() as {
    considered?: number; requested?: number; waiting?: number; processed?: number;
  };
  console.log("[stonePixDailyRequest] completed", {
    considered: result.considered ?? 0,
    requested: result.requested ?? 0,
    waiting: result.waiting ?? 0,
    processed: result.processed ?? 0,
  });
});
