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

/**
 * Aprovação por decurso de prazo das ausências, de hora em hora: aprova as etapas em análise cuja regra define
 * `tacitApprovalDays` e cujo prazo, contado da atribuição da etapa, venceu. Lê só pedidos já fora do prazo de 24 h.
 */
export const absenceTacitApprovalJob = onSchedule({
  schedule: '5 * * * *',
  timeZone: 'America/Belem',
  retryCount: 0,
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(new URL('/api/jobs/dp/absences/tacit-approval', jobUrl.value()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jobSecret.value()}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Aprovação por decurso respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { checked?: number; approved?: number; skipped?: number; skippedCodes?: Record<string, number> };
  if (result.approved || result.skipped) console.log('[absenceTacitApprovalJob] Concluída.', result);
});

/**
 * Pacotes do fechamento do mês (espelho e contracheque) sem assinatura em 24 horas ou recusados, de hora em hora:
 * mantém aberto o aviso no sino dos responsáveis pelo fechamento até o DP tratar e finalizar o mês.
 */
export const timeClosingOverdueJob = onSchedule({
  schedule: '20 * * * *',
  timeZone: 'America/Belem',
  retryCount: 0,
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(new URL('/api/jobs/dp/time-closing/overdue', jobUrl.value()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jobSecret.value()}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Atraso do fechamento respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { checked?: number; overdueClosures?: number };
  if (result.overdueClosures) console.log('[timeClosingOverdueJob] Concluída.', result);
});

/**
 * Acompanhamento das vigências operacionais que entraram em vigor (a cada 15 minutos): recalcula os
 * quiosques atribuídos e acompanha os acessos ao PDV. Sem pendências, a rota faz uma única consulta limitada.
 */
export const operationalFollowUpJob = onSchedule({
  schedule: '*/15 * * * *',
  timeZone: 'America/Belem',
  retryCount: 0,
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(new URL('/api/jobs/users/operational-follow-up', jobUrl.value()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jobSecret.value()}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Acompanhamento das vigências respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { processed?: number; failed?: number };
  if (result.processed || result.failed) console.log('[operationalFollowUpJob] Concluída.', result);
});

/** Dia escalado sem batida nem solicitação: registra falta injustificada 24 h após o fim do turno. */
export const automaticAbsenceJob = onSchedule({
  schedule: '35 * * * *',
  timeZone: 'America/Belem',
  retryCount: 0,
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [jobSecret],
}, async () => {
  const response = await fetch(new URL('/api/jobs/dp/time-recording/automatic-absences', jobUrl.value()), {
    method: 'POST', headers: { Authorization: `Bearer ${jobSecret.value()}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Faltas automáticas responderam HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { checked?: number; created?: number };
  if (result.created) console.log('[automaticAbsenceJob] Concluída.', result);
});
