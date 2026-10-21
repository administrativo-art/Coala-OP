import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const jobSecret = defineSecret('SYSTEM_NOTICES_JOB_SECRET');
const jobUrl = defineString('SYSTEM_NOTICES_JOB_URL', { default: 'https://op.coalashakes.com/api/jobs/system-notices/daily' });

/**
 * Rotina diária dos avisos do sistema: validade do certificado do ponto (marcos de 60 a 0 dias
 * e vencido), comprovantes pendentes e revisão das normas. A rota é idempotente.
 */
export const systemNoticesDailyMonitor = onSchedule({
  schedule: '0 8 * * *',
  timeZone: 'America/Belem',
  retryCount: 2,
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(jobUrl.value(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jobSecret.value()}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Avisos do sistema responderam HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { opened?: string[] };
  console.log('[systemNoticesDailyMonitor] Concluída.', { opened: result.opened?.length ?? 0 });
});

/**
 * Reemissão dos comprovantes de ponto pendentes a cada 15 minutos (a lei pede o comprovante a cada marcação).
 * Usa o mesmo segredo e a origem da URL da rotina diária. Sem pendentes, a rota faz uma única consulta.
 */
export const repPReceiptRetryJob = onSchedule({
  schedule: '*/15 * * * *',
  timeZone: 'America/Belem',
  retryCount: 0,
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(new URL('/api/jobs/rep-p/receipts-retry', jobUrl.value()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jobSecret.value()}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Reemissão de comprovantes respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { attempted?: number; issued?: number; failed?: number };
  if (result.attempted) console.log('[repPReceiptRetryJob] Concluída.', result);
});
