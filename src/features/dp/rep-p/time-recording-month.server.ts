import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { reportSystemError } from '@/lib/observability/reporter';

import type { AbsenceRequestRecord } from '@/features/dp/absences/requests/workflow-types';
import { listOwnAdjustments } from '@/features/dp/time-adjustments/service.server';
import type { DayAbsence } from './day-model';
import { assembleMonthDays, businessToday, monthAbsencesOf } from './month-days';
import { readOwnRepPMonth } from './own-month.server';
import { repPOwnMonthSchema } from './schemas';
import { listOwnRepPMarkings } from './service.server';

export const MONTH_ABSENCE_LIMIT = 200;

export function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return { startDate: `${month}-01`,
    endDate: `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}` };
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Ausências da pessoa que tocam o mês, pelo beneficiário. Uma consulta limitada (até 200), com janela de 366 dias
 * para trás, para que licenças longas iniciadas antes do mês também cubram os dias.
 */
export async function readMonthAbsencesOfPerson(workspaceId: string, beneficiaryUid: string, month: string) {
  const { startDate, endDate } = monthBounds(month);
  const snapshot = await hrDbAdmin.collection('dp_absenceRequests').where('workspaceId', '==', workspaceId)
    .where('beneficiaryUid', '==', beneficiaryUid).where('startDate', '>=', addDays(startDate, -366))
    .where('startDate', '<=', endDate).orderBy('startDate', 'desc').limit(MONTH_ABSENCE_LIMIT + 1).get();
  if (snapshot.size > MONTH_ABSENCE_LIMIT) {
    throw new AppError({ code: 'REP_P_EMPLOYEE_MONTH_ABSENCES_TRUNCATED', kind: 'VALIDATION',
      safeMessage: 'Há ausências demais para montar o mês com segurança.' });
  }
  return monthAbsencesOf(snapshot.docs.map((document) => document.data() as AbsenceRequestRecord), startDate);
}

/**
 * Mês da própria colaboradora numa leitura: escala, batidas até hoje, ajustes, ausências e o contrato central do dia.
 * Reúne as mesmas leituras que a tela fazia em quatro chamadas; não acrescenta consulta.
 */
export async function readOwnTimeRecordingMonth(context: ServerUserContext, raw: unknown, injected: { today?: string } = {}) {
  const parsed = repPOwnMonthSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: 'REP_P_MONTH_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Mês inválido.' });
  const { month } = parsed.data;
  const today = injected.today ?? businessToday();
  const { startDate, endDate } = monthBounds(month);
  const historyEnd = endDate < today ? endDate : today;
  // Como na tela anterior: escala e batidas são obrigatórias; sem ausências o mês abre com aviso, e sem ajustes
  // segue sem eles. A falha parcial é registrada para o suporte.
  const partial = (operation: string, code: string) => (error: unknown) => {
    reportSystemError({ error, source: 'rep-p', operation, code, kind: 'TRANSIENT_EXTERNAL', severity: 'medium', isTerminal: false,
      metadata: { month } });
  };
  const [schedule, history, adjustmentPayload, absenceResult] = await Promise.all([
    readOwnRepPMonth(context, { month }),
    startDate <= today ? listOwnRepPMarkings(context, { startDate, endDate: historyEnd }) : Promise.resolve({ markings: [], truncated: false }),
    listOwnAdjustments(context, { month })
      .catch((error) => { partial('read-own-month-adjustments', 'REP_P_MONTH_ADJUSTMENTS_UNAVAILABLE')(error); return { adjustments: [], treatments: [] }; }),
    readMonthAbsencesOfPerson(context.workspace_id, context.decoded.uid, month)
      .then((absences) => ({ ok: true as const, absences }), (error) => {
        partial('read-own-month-absences', 'REP_P_MONTH_ABSENCES_UNAVAILABLE')(error);
        return { ok: false as const, absences: [] as DayAbsence[] };
      }),
  ]);
  const absences = absenceResult.absences;
  return {
    schedule,
    history,
    absences,
    absencesUnavailable: !absenceResult.ok,
    adjustments: adjustmentPayload.adjustments,
    treatments: adjustmentPayload.treatments,
    monthDays: assembleMonthDays({ month, today, shifts: schedule.shifts, markings: history.markings, absences,
      treatments: adjustmentPayload.treatments }),
  };
}
