import 'server-only';

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';
import { readOfficialPersonMonth, type OfficialShift } from '@/features/dp/schedules/official-revision.server';

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
  const months = [...new Set([priorWorkDate.slice(0, 7), workDate.slice(0, 7)])];
  const revisionRows = await Promise.all(months.map(async (competence) => {
    const from = competence === priorWorkDate.slice(0, 7) ? priorWorkDate : workDate;
    const through = competence === workDate.slice(0, 7) ? workDate : priorWorkDate;
    const indexed = await readOfficialPersonMonth({ db, userId: uid, competence, from, through });
    return indexed.shifts;
  }));
  const legacy: OfficialShift[] = shifts.docs.map((shift) => ({ id: shift.id,
    scheduleId: shift.ref.parent.parent?.id ?? '', ...shift.data() }));
  const candidates = [...legacy, ...revisionRows.flat()].filter((shift) => {
    const unitId = shift.unitId;
    const originUnitId = shift.originUnitId;
    return typeof unitId === 'string' && unitId && !linkedUnitIds.includes(unitId)
      && typeof originUnitId === 'string' && linkedUnitIds.includes(originUnitId)
      && (shift.date === workDate || shift.date === priorWorkDate && shift.overnight === true)
      && typeof shift.exceptionReason === 'string' && shift.exceptionReason.trim()
      && shift.type === 'work' && shift.assignmentKind === 'external_coverage';
  });
  if (!candidates.length) return [];
  const scopes = [...new Map(candidates.map((shift) => {
    const unitId = String(shift.unitId);
    const competence = String(shift.date).slice(0, 7);
    return [`${unitId}:${competence}`, { unitId, competence }] as const;
  })).entries()];
  const schedulePages = await Promise.all(scopes.map(([, { unitId, competence }]) => {
    const [year, month] = competence.split('-').map(Number);
    return db.collection('dp_schedules').where('unitId', '==', unitId)
      .where('year', '==', year).where('month', '==', month)
      .select('createdAt', 'publicationStatus', 'publicationVersion', 'activeRevisionId').limit(MAX_UNIT_SCHEDULES).get();
  }));
  if (schedulePages.some((page) => page.size >= MAX_UNIT_SCHEDULES)) return [];
  const currentByUnit = new Map<string, string>();
  for (const [index, page] of schedulePages.entries()) {
    const latest = page.docs.filter((item) => hasPublishedScheduleVersion(item.data())).sort((a, b) =>
      millis(b.get('createdAt')) - millis(a.get('createdAt')))[0];
    if (latest) currentByUnit.set(scopes[index][0], latest.id);
  }
  const revisionBySchedule = new Map(schedulePages.flatMap((page) => page.docs.map((schedule) => [schedule.id,
    typeof schedule.get('activeRevisionId') === 'string'] as const)));
  return candidates.flatMap((shift) => {
    const unitId = shift.unitId;
    const scope = `${unitId}:${String(shift.date).slice(0, 7)}`;
    const cameFromRevision = revisionRows.flat().some((row) => row.scheduleId === shift.scheduleId && row.id === shift.id);
    if (revisionBySchedule.get(shift.scheduleId) !== cameFromRevision) return [];
    return typeof unitId === 'string' && currentByUnit.get(scope) === shift.scheduleId
      ? [{ executionUnitId: unitId, originUnitId: String(shift.originUnitId),
        scheduleId: shift.scheduleId, shiftId: shift.id,
        scheduledDate: String(shift.date), overnight: shift.overnight === true,
        shiftHash: createHash('sha256').update(JSON.stringify([shift.scheduleId, shift.id,
          shift.userId, shift.unitId, shift.originUnitId, shift.date,
          shift.type, shift.assignmentKind, shift.overnight === true,
          shift.startTime, shift.endTime, shift.exceptionReason])).digest('hex') }] : [];
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
