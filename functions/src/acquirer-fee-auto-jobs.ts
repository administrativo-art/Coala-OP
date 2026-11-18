import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const reconciliationSecret = defineSecret('INTER_RECONCILIATION_SECRET');
const autoUrl = process.env.ACQUIRER_FEE_AUTO_URL?.trim()
  || 'https://op.coalashakes.com/api/jobs/acquirer-fees/auto';

/**
 * Reconhece as taxas de venda conciliada dos últimos dias, uma vez por dia.
 * Cada unidade tem seu modo (desligada, simulação, ativa) no cadastro da Stone;
 * sem unidade ligada a rotina não faz nada. A rota reaproveita as mesmas travas
 * do botão Reconhecer, então reexecutar não duplica despesa.
 */
export const acquirerFeeAutoRecognition = onSchedule({
  schedule: '40 5 * * *',
  timeZone: 'America/Belem',
  retryCount: 1,
  timeoutSeconds: 320,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [reconciliationSecret],
}, async () => {
  const response = await fetch(autoUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reconciliationSecret.value()}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Reconhecimento automático de taxas respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { today?: string; units?: Array<{ mode?: string; recognized?: number; wouldRecognize?: number; pending?: unknown[] }> };
  const ran = (result.units ?? []).filter(unit => unit.mode && unit.mode !== 'off');
  console.log('[acquirerFeeAutoRecognition] Concluída.', {
    today: result.today,
    units: ran.length,
    recognized: ran.reduce((sum, unit) => sum + (unit.recognized ?? 0), 0),
    wouldRecognize: ran.reduce((sum, unit) => sum + (unit.wouldRecognize ?? 0), 0),
    pending: ran.reduce((sum, unit) => sum + (unit.pending?.length ?? 0), 0),
  });
});
