import 'server-only';

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

const MAX_DAY_SHIFTS = 30;
const MAX_UNIT_SCHEDULES = 20;

function millis(value: unknown) {
  return value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function'
    ? Number(value.toMillis()) : 0;
}

/** A cobertura excepcional da escala vigente autoriza somente a pessoa, a data e a unidade do turno. */
export async function externalCoverageGrants(db: Firestore, uid: string, workDate: string, linkedUnitIds: readonly string[]) {
  const previousDate = new Date(`${workDate}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const priorWorkDate = previousDate.toISOString().slice(0, 10);
  const shifts = await db.collectionGroup('shifts').where('userId', '==', uid)
    .where('date', 'in', [priorWorkDate, workDate])
    .limit(MAX_DAY_SHIFTS).get();
  // Sem visão completa do dia, nenhuma autorização excepcional é inferida.
  if (shifts.size >= MAX_DAY_SHIFTS) return [];
  const candidates = shifts.docs.filter((shift) => {
    const unitId = shift.get('unitId');
    const originUnitId = shift.get('originUnitId');
    return typeof unitId === 'string' && unitId && !linkedUnitIds.includes(unitId)
      && typeof originUnitId === 'string' && linkedUnitIds.includes(originUnitId)
      && (shift.get('date') === workDate || shift.get('date') === priorWorkDate && shift.get('overnight') === true)
      && typeof shift.get('exceptionReason') === 'string' && String(shift.get('exceptionReason')).trim()
      && shift.get('type') === 'work' && shift.get('assignmentKind') === 'external_coverage';
  });
  if (!candidates.length) return [];
  const scopes = [...new Map(candidates.map((shift) => {
    const unitId = String(shift.get('unitId'));
    const competence = String(shift.get('date')).slice(0, 7);
    return [`${unitId}:${competence}`, { unitId, competence }] as const;
  })).entries()];
  const schedulePages = await Promise.all(scopes.map(([, { unitId, competence }]) => {
    const [year, month] = competence.split('-').map(Number);
    return db.collection('dp_schedules').where('unitId', '==', unitId)
      .where('year', '==', year).where('month', '==', month)
      .select('locked', 'createdAt').limit(MAX_UNIT_SCHEDULES).get();
  }));
  if (schedulePages.some((page) => page.size >= MAX_UNIT_SCHEDULES)) return [];
  const currentByUnit = new Map<string, string>();
  for (const [index, page] of schedulePages.entries()) {
    const latest = [...page.docs].sort((a, b) =>
      Number(b.get('locked') === true) - Number(a.get('locked') === true)
        || millis(b.get('createdAt')) - millis(a.get('createdAt')))[0];
    if (latest) currentByUnit.set(scopes[index][0], latest.id);
  }
  return candidates.flatMap((shift) => {
    const unitId = shift.get('unitId');
    const scope = `${unitId}:${String(shift.get('date')).slice(0, 7)}`;
    return typeof unitId === 'string' && currentByUnit.get(scope) === shift.ref.parent.parent?.id
      ? [{ executionUnitId: unitId, originUnitId: String(shift.get('originUnitId')),
        scheduleId: String(shift.ref.parent.parent?.id), shiftId: shift.id,
        scheduledDate: String(shift.get('date')), overnight: shift.get('overnight') === true,
        shiftHash: createHash('sha256').update(JSON.stringify([shift.ref.parent.parent?.id, shift.id,
          shift.get('userId'), shift.get('unitId'), shift.get('originUnitId'), shift.get('date'),
          shift.get('type'), shift.get('assignmentKind'), shift.get('overnight') === true,
          shift.get('startTime'), shift.get('endTime'), shift.get('exceptionReason')])).digest('hex') }] : [];
  });
}

export async function externalCoverageUnits(db: Firestore, uid: string, workDate: string, linkedUnitIds: readonly string[]) {
  return [...new Set((await externalCoverageGrants(db, uid, workDate, linkedUnitIds)).map((grant) => grant.executionUnitId))];
}

export async function allowedExecutionUnit(db: Firestore, uid: string, workDate: string,
  linkedUnitIds: readonly string[], unitId: string) {
  if (linkedUnitIds.includes(unitId)) return true;
  return (await externalCoverageUnits(db, uid, workDate, linkedUnitIds)).includes(unitId);
}
