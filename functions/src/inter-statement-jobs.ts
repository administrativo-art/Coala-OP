import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const reconciliationSecret = defineSecret('INTER_RECONCILIATION_SECRET');
const statementSyncUrl = defineString('INTER_STATEMENT_SYNC_URL');

/**
 * Mantém o extrato do Banco Inter sincronizado com o fluxo de caixa.
 * A rota de destino é idempotente: cada evento bancário possui chave estável,
 * e uma nova execução apenas acrescenta movimentações ainda não conhecidas.
 */
export const interStatementSync = onSchedule({
  schedule: '*/15 6-23 * * *',
  timeZone: 'America/Belem',
  retryCount: 2,
  timeoutSeconds: 300,
  memory: '512MiB',
  maxInstances: 1,
  secrets: [reconciliationSecret],
}, async () => {
  const response = await fetch(statementSyncUrl.value(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reconciliationSecret.value()}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Sincronização do extrato Inter respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const result = await response.json() as {
    received?: number;
    inserted?: number;
    reconciledExisting?: number;
    autoMatched?: number;
    pendingAudit?: number;
  };
  console.log('[interStatementSync] Concluída.', result);
});
