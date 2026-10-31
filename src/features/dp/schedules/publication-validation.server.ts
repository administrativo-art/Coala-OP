import 'server-only';

import { createHash } from 'node:crypto';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';
import { operationalDayRefs, operationalReadinessRef, operationalReadinessValid,
  shiftOccupancySlices, type OccupancySlice } from '@/features/dp/absences/operational/occupancy-guard.server';
import { readOfficialPersonMonth, readOfficialScheduleShifts } from './official-revision.server';

type Shift = Record<string, unknown> & { id: string; scheduleId: string };
const MAX_PARTICIPANTS = 500;
const MAX_OTHER_SHIFTS = 31_000;
const MAX_MARKER_DAYS = 1_000;

function fail(code: string, message: string): never {
  throw new AppError({ code, kind: 'CONFLICT', safeMessage: message });
}
function dayBefore(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
function sliceFor(shift: Shift): OccupancySlice[] {
  const beneficiaryUid = shift.userId;
  const date = shift.date;
  if (typeof beneficiaryUid !== 'string' || !beneficiaryUid || typeof date !== 'string'
    || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) fail('DP_PUBLICATION_SHIFT_INVALID', 'Um turno da escala está inconsistente.');
  if (shift.type === 'day_off') return [{ beneficiaryUid, date, fromMinute: 0, toMinute: 1440, addsOccupancy: true }];
  if (shift.type !== 'work') fail('DP_PUBLICATION_SHIFT_INVALID', 'Um turno da escala está inconsistente.');
  return shiftOccupancySlices({ beneficiaryUid, date, startTime: shift.startTime as string,
    endTime: shift.endTime as string, addsOccupancy: true });
}
function overlaps(a: OccupancySlice, b: OccupancySlice) {
  return a.beneficiaryUid === b.beneficiaryUid && a.date === b.date
    && a.fromMinute < b.toMinute && b.fromMinute < a.toMinute;
}
function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

/** Run after capturing publication fence and before preparing the revision. */
export async function validatePublicationOccupancy(params: {
  scheduleId: string; workspaceId: string; year: number; month: number;
  shifts: Shift[];
}) {
  const { scheduleId, workspaceId, year, month, shifts } = params;
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const through = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const prior = dayBefore(first);
  const participants = [...new Set(shifts.map((shift) => shift.userId)
    .filter((userId): userId is string => typeof userId === 'string' && Boolean(userId)))];
  if (shifts.some((shift) => typeof shift.userId !== 'string' || !shift.userId)) fail('DP_PUBLICATION_SHIFT_INVALID', 'Um turno da escala está inconsistente.');
  if (participants.length > MAX_PARTICIPANTS) fail('DP_PUBLICATION_PARTICIPANT_LIMIT', 'Há pessoas demais nesta escala para validar a disponibilidade.');
  if (shifts.some((shift) => shift.scheduleId !== scheduleId || typeof shift.date !== 'string'
    || shift.date < first || shift.date > through)) fail('DP_PUBLICATION_PERIOD_INVALID', 'A escala contém turno fora da competência.');
  const proposedSlices = shifts.flatMap(sliceFor);
  const other = new Map<string, Shift>();
  const pointerSchedulesByMonth = new Map<string, Promise<string[]>>();
  const jobs = participants.flatMap((userId) => [...new Set([prior.slice(0, 7), first.slice(0, 7)])]
    .map((competence) => ({ userId, competence })));
  for (const jobChunk of chunks(jobs, 20)) {
    const results = await Promise.all(jobChunk.map(async ({ userId, competence }) => {
      const indexed = await readOfficialPersonMonth({ userId, competence });
      if (indexed.indexed) return indexed.shifts;
      if (!pointerSchedulesByMonth.has(competence)) {
        pointerSchedulesByMonth.set(competence, (async () => {
          const [candidateYear, candidateMonth] = competence.split('-').map(Number);
          const schedules = await dbAdmin.collection('dp_schedules').where('year', '==', candidateYear)
            .where('month', '==', candidateMonth).limit(21).get();
          if (schedules.size === 21) fail('DP_PUBLICATION_CANDIDATE_LIMIT', 'Há escalas demais para validar a disponibilidade.');
          return schedules.docs.filter((item) => item.get('activeRevisionId')).map((item) => item.id);
        })());
      }
      const ids = await pointerSchedulesByMonth.get(competence)!;
      return (await Promise.all(ids.map((id) => readOfficialScheduleShifts({ scheduleId: id, userId })))).flatMap((item) => item.shifts);
    }));
    results.flat().filter((shift) => shift.scheduleId !== scheduleId && typeof shift.date === 'string'
      && shift.date >= prior && shift.date <= through).forEach((shift) => other.set(`${shift.scheduleId}:${shift.id}`, shift as Shift));
  }
  for (const participantChunk of chunks(participants, 20)) {
    const results = await Promise.all(participantChunk.map((userId) => dbAdmin.collectionGroup('shifts').where('userId', '==', userId)
      .where('date', '>=', prior).where('date', '<=', through).orderBy('date').limit(MAX_OTHER_SHIFTS + 1).get()));
    for (const physical of results) {
      if (physical.size > MAX_OTHER_SHIFTS) fail('DP_PUBLICATION_OCCUPANCY_LIMIT', 'Há turnos demais para validar a disponibilidade.');
      const scheduleRefs = [...new Map(physical.docs.flatMap((item) => {
        const ref = item.ref.parent.parent;
        return ref?.parent.id === 'dp_schedules' ? [[ref.path, ref] as const] : [];
      })).values()];
      const schedules = scheduleRefs.length ? await dbAdmin.getAll(...scheduleRefs) : [];
      const legacy = new Set(schedules.filter((item) => !item.get('activeRevisionId')
        && hasPublishedScheduleVersion(item.data() ?? {})).map((item) => item.id));
      physical.docs.forEach((item) => {
        const parent = item.ref.parent.parent;
        if (parent && parent.id !== scheduleId && legacy.has(parent.id)) {
          other.set(`${parent.id}:${item.id}`, { id: item.id, scheduleId: parent.id, ...item.data() } as Shift);
        }
      });
    }
  }
  if (other.size > MAX_OTHER_SHIFTS) fail('DP_PUBLICATION_OCCUPANCY_LIMIT', 'Há turnos demais para validar a disponibilidade.');
  const byDay = new Map<string, Array<{ shift: string; slice: OccupancySlice }>>();
  for (const shift of [...shifts, ...other.values()]) {
    for (const slice of sliceFor(shift)) {
      const key = createHash('sha256').update(`${slice.beneficiaryUid}:${slice.date}`).digest('hex');
      const existing = byDay.get(key) ?? [];
      if (existing.some((item) => item.shift !== `${shift.scheduleId}:${shift.id}` && overlaps(item.slice, slice))) {
        fail('DP_PUBLICATION_OCCUPANCY_CONFLICT', 'Uma pessoa possui turnos ou folgas sobrepostos.');
      }
      existing.push({ shift: `${shift.scheduleId}:${shift.id}`, slice });
      byDay.set(key, existing);
    }
  }
  const vacations = (await Promise.all(chunks(participants, 20).map(async (group) =>
    Promise.all(group.map((userId) => dbAdmin.collection('dp_vacations')
      .where('userId', '==', userId).limit(101).get()))))).flat();
  vacations.forEach((result, index) => {
    if (result.size === 101) fail('DP_PUBLICATION_VACATION_LIMIT', 'Há férias demais para validar a disponibilidade.');
    const userId = participants[index];
    for (const vacation of result.docs) {
      if (vacation.get('status') !== 'APPROVED' || vacation.get('recordType') !== 'gozo') continue;
      const start = vacation.get('startDate'); const end = vacation.get('endDate');
      if (typeof start !== 'string' || typeof end !== 'string' || start > end) fail('DP_PUBLICATION_VACATION_INVALID', 'O período de férias está inconsistente.');
      if (proposedSlices.some((slice) => slice.beneficiaryUid === userId && slice.date >= start && slice.date <= end)) {
        fail('DP_PUBLICATION_VACATION_CONFLICT', 'Uma pessoa está de férias em data da escala.');
      }
    }
  });
  const readiness = await operationalReadinessRef(workspaceId).get();
  if (operationalReadinessValid(readiness, workspaceId)) {
    const days = [...new Map(proposedSlices.map((slice) =>
      [`${slice.beneficiaryUid}:${slice.date}`, { userId: slice.beneficiaryUid, date: slice.date }])).values()];
    if (days.length > MAX_MARKER_DAYS) fail('DP_PUBLICATION_MARKER_LIMIT', 'Há dias demais para validar ausências.');
    const markers = await Promise.all(days.map(({ userId, date }) => operationalDayRefs(workspaceId, userId, date).marker.get()));
    markers.forEach((marker, index) => {
      if (!marker.exists) return;
      if (marker.get('workspaceId') !== workspaceId || marker.get('beneficiaryUid') !== days[index].userId
        || marker.get('date') !== days[index].date || marker.get('epoch') !== readiness.get('epoch')) {
        fail('DP_PUBLICATION_MARKER_INVALID', 'Uma ausência operacional está inconsistente.');
      }
      const entries = marker.get('entries');
      if (!Array.isArray(entries) || entries.length > 20) fail('DP_PUBLICATION_MARKER_INVALID', 'Uma ausência operacional está inconsistente.');
      for (const entry of entries) {
        if (!entry || typeof entry.fromMinute !== 'number' || typeof entry.toMinute !== 'number'
          || typeof entry.blocksSchedule !== 'boolean' || !['prepared', 'active', 'tombstone'].includes(entry.state)) {
          fail('DP_PUBLICATION_MARKER_INVALID', 'Uma ausência operacional está inconsistente.');
        }
        if (entry.blocksSchedule && ['prepared', 'active'].includes(entry.state)
          && proposedSlices.some((slice) => slice.beneficiaryUid === days[index].userId
            && slice.date === days[index].date && slice.fromMinute < entry.toMinute && entry.fromMinute < slice.toMinute)) {
          fail('DP_PUBLICATION_ABSENCE_CONFLICT', 'Uma ausência bloqueia turno desta escala.');
        }
      }
    });
  }
  return { participantCount: participants.length, otherShiftCount: other.size, checkedDayCount: byDay.size };
}
