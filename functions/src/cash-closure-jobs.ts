import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const jobSecret = defineSecret('CASH_CLOSURE_JOB_SECRET');
const jobUrl = defineString('CASH_CLOSURE_JOB_URL');

export const cashClosureDailySync = onSchedule({
  schedule: '0 6 * * *',
  timeZone: 'America/Belem',
  retryCount: 2,
  timeoutSeconds: 300,
  memory: '512MiB',
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(jobUrl.value(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jobSecret.value()}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Job de fechamento respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  console.log('[cashClosureDailySync] Concluído.', await response.json());
});
