import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const schedulerSecret = defineSecret("FINANCIAL_BUDGET_SCHEDULER_SECRET");
const generationUrl = defineString("FINANCIAL_BUDGET_GENERATION_URL", {
  default: "https://op.coalashakes.com/api/jobs/financial-budgets/generate",
});

export const financialBudgetGeneration = onSchedule({
  schedule: "30 3 * * *",
  timeZone: "America/Belem",
  retryCount: 2,
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [schedulerSecret],
}, async () => {
  const targetUrl = generationUrl.value().trim();
  if (!targetUrl.startsWith("https://")) {
    throw new Error("Configure FINANCIAL_BUDGET_GENERATION_URL com a URL HTTPS da aplicação.");
  }
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "x-financial-budget-scheduler-secret": schedulerSecret.value() },
  });
  if (!response.ok) throw new Error(`Geração de orçamentos respondeu HTTP ${response.status}.`);
});
