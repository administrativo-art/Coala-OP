import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const jobSecret = defineSecret("ASSET_MAINTENANCE_JOB_SECRET");
const jobUrl = defineString("ASSET_MAINTENANCE_JOB_URL", {
  default: "https://op.coalashakes.com/api/jobs/assets/maintenance-materialize",
});

/**
 * Materializa uma vez ao dia somente os planos cuja antecedência (`materializeOn`) venceu.
 * A rota limita a consulta a 100 planos e IDs determinísticos tornam retries idempotentes.
 */
export const assetMaintenanceDailyMaterialize = onSchedule({
  schedule: "15 5 * * *",
  timeZone: "America/Belem",
  retryCount: 2,
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(jobUrl.value(), {
    method: "POST",
    headers: { Authorization: `Bearer ${jobSecret.value()}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Materialização de manutenção respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { scanned?: number; created?: number };
  console.log("[assetMaintenanceDailyMaterialize] Concluída.", result);
});
