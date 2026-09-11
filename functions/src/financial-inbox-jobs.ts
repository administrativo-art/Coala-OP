import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const reconciliationSecret = defineSecret('INTER_RECONCILIATION_SECRET');
const maintenanceUrl = process.env.FINANCIAL_INBOX_MAINTENANCE_URL?.trim()
  || 'https://op.coalashakes.com/api/jobs/financial-inbox/maintenance';

/**
 * Indexa mensagens legadas, aplica o contrato de resolução e arquiva cobranças
 * tratadas há mais de seis meses.
 * O job preserva documentos, vínculos e eventos; não executa expurgo definitivo.
 */
export const financialInboxMaintenance = onSchedule({
  schedule: '20 2 * * *',
  timeZone: 'America/Belem',
  retryCount: 2,
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [reconciliationSecret],
}, async () => {
  const response = await fetch(maintenanceUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reconciliationSecret.value()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode: 'execute', batchSize: 300 }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Manutenção da caixa financeira respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as {
    searchIndex?: { scanned?: number; indexed?: number; complete?: boolean };
    resolutionContract?: { scanned?: number; updated?: number; complete?: boolean };
    retention?: { eligible?: number; archived?: number };
  };
  console.log('[financialInboxMaintenance] Concluída.', result);
});
