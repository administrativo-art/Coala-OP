import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const jobSecret = defineSecret('CASH_DEPOSIT_RECONCILIATION_SECRET');
const jobUrl = defineString('CASH_DEPOSIT_RECONCILIATION_URL');

export const cashDepositDailyReconciliation = onSchedule({
  schedule: '0 7 * * *',
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
    throw new Error(`Reconciliação de depósitos respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  console.log('[cashDepositDailyReconciliation] Concluída.', await response.json());
});
