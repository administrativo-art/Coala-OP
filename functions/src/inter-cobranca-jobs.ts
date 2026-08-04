import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const reconciliationSecret = defineSecret('INTER_RECONCILIATION_SECRET');
const reconciliationUrl = defineString('INTER_RECONCILIATION_URL');

export const interCobrancaReconciliation = onSchedule({
  schedule: '0 8-18/2 * * 1-5',
  timeZone: 'America/Belem',
  retryCount: 2,
  timeoutSeconds: 300,
  memory: '512MiB',
  secrets: [reconciliationSecret],
}, async () => {
  const response = await fetch(reconciliationUrl.value(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reconciliationSecret.value()}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Reconciliação Inter respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  console.log('[interCobrancaReconciliation] Concluída.', await response.json());
});
