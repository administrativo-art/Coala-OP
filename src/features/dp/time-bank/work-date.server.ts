import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { readDisplacedShifts, readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import { AppError } from '@/lib/observability/app-error';

import { shiftReadRange, type WorkDateShift } from './work-date';

export type WorkDateSources = { mainDb: Firestore; hrDb: Firestore };

/**
 * Turnos que decidem a que dia pertencem as batidas de um período: da véspera ao dia seguinte, da escala publicada
 * mais os turnos que a falta automática retirou dela (a pessoa continua podendo ajustar esse dia).
 * Custo por pessoa e período: 1 usuário, a escala de até 2 meses nas bordas e 1 consulta de faltas automáticas.
 */
export async function readWorkDateShifts(workspaceId: string, uid: string, start: string, end: string,
  sources: WorkDateSources): Promise<WorkDateShift[]> {
  const range = shiftReadRange(start, end);
  const competences = new Set<string>();
  for (let cursor = Date.parse(`${range.start}T12:00:00Z`); cursor <= Date.parse(`${range.end}T12:00:00Z`); cursor += 86_400_000) {
    competences.add(new Date(cursor).toISOString().slice(0, 7));
  }
  const user = await sources.mainDb.collection('users').doc(uid).get();
  const hrEmployeeId = user.get('hrEmployeeId');
  const ids = [uid, typeof hrEmployeeId === 'string' ? hrEmployeeId : null];
  const [months, displaced] = await Promise.all([
    Promise.all([...competences].map((competence) => readRepPMonthOfPerson(ids, competence, { db: sources.mainDb }))),
    readDisplacedShifts(sources.hrDb, workspaceId, uid, range.start, range.end),
  ]);
  if (months.some((month) => month.truncated) || displaced.truncated) {
    throw new AppError({ code: 'PTRP_WORK_DATE_SHIFTS_TRUNCATED', kind: 'DATA_INTEGRITY',
      safeMessage: 'Há turnos demais para conferir a que dia as batidas pertencem. Fale com o desenvolvimento.' });
  }
  return [...months.flatMap((month) => month.shifts), ...displaced.shifts].filter((shift) => shift.date >= range.start && shift.date <= range.end);
}
