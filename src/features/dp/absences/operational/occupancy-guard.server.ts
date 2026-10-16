import 'server-only';

import { createHash } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { absenceCivilDateSchema } from '../requests/schemas';

export const ABSENCE_OPERATIONAL_COVERAGE_HASH = 'absence-occupancy-writers-v1';
export type OccupancySlice = { beneficiaryUid: string; date: string; fromMinute: number; toMinute: number; addsOccupancy: boolean };
const key = (value: string) => createHash('sha256').update(value).digest('hex');
const failure = (code: string) => new AppError({ code, kind: 'CONFLICT',
  safeMessage: 'A disponibilidade operacional não pôde ser confirmada. Tente novamente após revisão do DP.' });

export function operationalGuardRequested() {
  const value = process.env.DP_ABSENCE_OPERATIONAL_GUARD;
  if (!value || value === 'off') return false;
  // Until the coverage bootstrap/legacy Functions and maintenance writers are certified,
  // ON is restricted to a local Firestore emulator. An env toggle alone cannot promote it.
  if (value === 'on') {
    const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
    if (process.env.NODE_ENV === 'production'
      || !loopback.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')
      || !loopback.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')
      || !/^demo-[a-z0-9-]+$/.test(adminApp.options.projectId ?? '')) {
      throw failure('ABSENCE_OPERATIONAL_PRODUCTION_NOT_READY');
    }
    return true;
  }
  throw failure('ABSENCE_OPERATIONAL_GUARD_CONFIG_INVALID');
}

export function operationalReadinessRef(workspaceId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) throw failure('ABSENCE_OPERATIONAL_WORKSPACE_INVALID');
  return dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId);
}
export function operationalDayRefs(workspaceId: string, beneficiaryUid: string, date: string) {
  const id = key(`${workspaceId}:${beneficiaryUid}:${date}`);
  return { clock: dbAdmin.collection('dp_absenceOccupancyClocks').doc(id),
    marker: dbAdmin.collection('dp_absenceOperationalMarkers').doc(id) };
}
export function operationalReadinessValid(raw: FirebaseFirestore.DocumentSnapshot, workspaceId: string) {
  return raw.exists && raw.get('workspaceId') === workspaceId && raw.get('state') === 'ready'
    && raw.get('bootstrapComplete') === true && raw.get('coverageHash') === ABSENCE_OPERATIONAL_COVERAGE_HASH
    && raw.get('scopeKind') === 'workspace_all'
    && typeof raw.get('scopeHash') === 'string' && /^[0-9a-f]{64}$/.test(raw.get('scopeHash'))
    && typeof raw.get('epoch') === 'string' && /^[0-9a-f-]{36}$/i.test(raw.get('epoch'));
}
function validSlice(slice: OccupancySlice) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(slice.beneficiaryUid) && absenceCivilDateSchema.safeParse(slice.date).success
    && Number.isInteger(slice.fromMinute) && Number.isInteger(slice.toMinute)
    && slice.fromMinute >= 0 && slice.toMinute <= 1440 && slice.fromMinute < slice.toMinute;
}
function overlaps(left: Pick<OccupancySlice, 'fromMinute' | 'toMinute'>, right: Pick<OccupancySlice, 'fromMinute' | 'toMinute'>) {
  return left.fromMinute < right.toMinute && right.fromMinute < left.toMinute;
}

/** Call after domain reads and before the first write in the same Coala transaction. OFF performs no reads/writes. */
export async function guardOccupancyWrite(transaction: Transaction, workspaceId: string, slices: OccupancySlice[],
  domainWrites = 0, collision: 'blocking_absence' | 'any_absence' = 'blocking_absence') {
  if (!operationalGuardRequested()) return { guarded: false as const };
  if (slices.length > 400 || slices.some((slice) => !validSlice(slice))) throw failure('ABSENCE_OPERATIONAL_SCOPE_INVALID');
  const readiness = await transaction.get(operationalReadinessRef(workspaceId));
  if (!operationalReadinessValid(readiness, workspaceId)) throw failure('ABSENCE_OPERATIONAL_NOT_READY');
  const epoch = readiness.get('epoch') as string;
  const byDay = new Map<string, OccupancySlice[]>();
  for (const slice of slices) {
    const id = `${slice.beneficiaryUid}:${slice.date}`;
    byDay.set(id, [...(byDay.get(id) ?? []), slice]);
  }
  if (byDay.size > 180 || byDay.size + domainWrites > 450) throw failure('ABSENCE_OPERATIONAL_WRITE_LIMIT');
  const refs = [...byDay].map(([id, values]) => ({ id, values, ...operationalDayRefs(workspaceId, values[0].beneficiaryUid, values[0].date) }));
  const readings = await Promise.all(refs.map(async ({ clock, marker }) => ({
    clock: await transaction.get(clock), marker: await transaction.get(marker),
  })));
  readings.forEach(({ clock, marker }, index) => {
    const entries = marker.exists ? marker.get('entries') : [];
    if (!Array.isArray(entries) || entries.length > 20 || entries.some((entry) => !entry
      || typeof entry.requestId !== 'string' || !Number.isInteger(entry.fromMinute) || !Number.isInteger(entry.toMinute)
      || entry.fromMinute < 0 || entry.toMinute > 1440 || entry.fromMinute >= entry.toMinute
      || !Number.isSafeInteger(entry.requestVersion) || entry.requestVersion < 1
      || typeof entry.fenceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.fenceId)
      || typeof entry.blocksSchedule !== 'boolean'
      || !['prepared', 'active', 'tombstone'].includes(entry.state))) throw failure('ABSENCE_OPERATIONAL_MARKER_INVALID');
    if (marker.exists && (marker.get('workspaceId') !== workspaceId
      || marker.get('beneficiaryUid') !== refs[index].values[0].beneficiaryUid
      || marker.get('date') !== refs[index].values[0].date || marker.get('epoch') !== epoch)) {
      throw failure('ABSENCE_OPERATIONAL_MARKER_INVALID');
    }
    if (clock.exists && clock.get('epoch') !== epoch) throw failure('ABSENCE_OPERATIONAL_CLOCK_EPOCH_CHANGED');
    if (clock.exists && (clock.get('workspaceId') !== workspaceId
      || clock.get('beneficiaryUid') !== refs[index].values[0].beneficiaryUid
      || clock.get('date') !== refs[index].values[0].date)) throw failure('ABSENCE_OPERATIONAL_CLOCK_INVALID');
    for (const slice of refs[index].values) {
      if (slice.addsOccupancy && entries.some((entry) => (entry.blocksSchedule === true || collision === 'any_absence')
        && ['prepared', 'active'].includes(entry.state) && overlaps(slice, entry))) {
        throw failure('ABSENCE_OPERATIONAL_CONFLICT');
      }
    }
  });
  readings.forEach(({ clock }, index) => {
    const values = refs[index].values;
    const version = clock.exists ? clock.get('version') : 0;
    if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) throw failure('ABSENCE_OPERATIONAL_CLOCK_INVALID');
    transaction.set(refs[index].clock, { workspaceId, beneficiaryUid: values[0].beneficiaryUid,
      date: values[0].date, epoch, version: version + 1, updatedAt: new Date().toISOString() });
  });
  return { guarded: true as const, epoch, touchedDays: refs.length };
}

export function shiftOccupancySlices(input: { beneficiaryUid: string; date: string; startTime?: string | null;
  endTime?: string | null; addsOccupancy: boolean }): OccupancySlice[] {
  const validTime = (value: string | null | undefined) => typeof value === 'string'
    && /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) <= 24
    && Number(value.slice(3)) < 60 && (value.slice(0, 2) !== '24' || value.slice(3) === '00');
  if (!absenceCivilDateSchema.safeParse(input.date).success || !validTime(input.startTime)
    || !validTime(input.endTime)) throw failure('ABSENCE_SHIFT_TIME_INVALID');
  const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = minute(input.startTime!); const end = minute(input.endTime!);
  if (start >= 1440 || end > 1440 || start === end) throw failure('ABSENCE_SHIFT_TIME_INVALID');
  const first = { beneficiaryUid: input.beneficiaryUid, date: input.date, fromMinute: start,
    toMinute: end > start ? end : 1440, addsOccupancy: input.addsOccupancy };
  if (end > start) return [first];
  const nextDate = new Date(Date.parse(`${input.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return end === 0 ? [first] : [first, { beneficiaryUid: input.beneficiaryUid, date: nextDate,
    fromMinute: 0, toMinute: end, addsOccupancy: input.addsOccupancy }];
}

export function vacationOccupancySlices(input: { beneficiaryUid: string; startDate: string; endDate: string;
  addsOccupancy: boolean }): OccupancySlice[] {
  if (!absenceCivilDateSchema.safeParse(input.startDate).success
    || !absenceCivilDateSchema.safeParse(input.endDate).success || input.startDate > input.endDate) {
    throw failure('ABSENCE_VACATION_PERIOD_INVALID');
  }
  const start = Date.parse(`${input.startDate}T00:00:00Z`);
  const end = Date.parse(`${input.endDate}T00:00:00Z`);
  const count = Math.round((end - start) / 86_400_000) + 1;
  if (count > 180) throw failure('ABSENCE_OPERATIONAL_WRITE_LIMIT');
  return Array.from({ length: count }, (_, index) => ({ beneficiaryUid: input.beneficiaryUid,
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    fromMinute: 0, toMinute: 1440, addsOccupancy: input.addsOccupancy }));
}
