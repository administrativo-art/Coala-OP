import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const reconciliationSecret = defineSecret('INTER_RECONCILIATION_SECRET');
const reconciliationUrl = defineString('INTER_PAYMENT_RECONCILIATION_URL');

/**
 * Fallback do webhook do Inter para pagamentos Pix enviados.
 *
 * Este job chama apenas a rota de consulta/conciliação. Ele nunca cria nem
 * reenvia pagamentos ao banco.
 */
export const interPaymentReconciliation = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'America/Belem',
  retryCount: 1,
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
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
    throw new Error(`Reconciliação de pagamentos Inter respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { processed?: number };
  console.log('[interPaymentReconciliation] Concluída.', { processed: result.processed ?? 0 });
});
