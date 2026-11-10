import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { isBrazilTimeZone } from '@/features/dp/rep-p/time-zones';
import { readOfficialScheduleShifts, type OfficialShift } from '@/features/dp/schedules/official-revision.server';
import { hasPublishedScheduleVersion, scheduleShiftFingerprint } from '@/lib/dp-schedule-publication';
import { prepareActiveRevisionOperationalChanges, readActiveRevisionShift } from '@/features/dp/schedules/operational-overlay.server';
import { readActiveRevisionPersonMonth } from '@/features/dp/schedules/operational-overlay.server';
import { preparePublicationFenceAdvance } from '@/features/dp/schedules/publication-fence.server';
import { evaluateCoverageAgenda } from '@/features/dp/absences/coverage/core';
import { guardOccupancyWrite, shiftOccupancySlices } from '@/features/dp/absences/operational/occupancy-guard.server';
import { AppError } from '@/lib/observability/app-error';
import { resolveOperationalResponsibility, responsibilityScopeKey } from '@/features/dp/responsibility-coverage/service.server';

import { ADJUSTMENTS, CLOSURES, closureKey } from './service.server';
import { adjustmentRestoresAutomaticAbsence, automaticAbsenceDeadline } from './automatic-absence-core';

export const AUTOMATIC_ABSENCES = 'ptrp_automaticAbsences';
const AUTOMATIC_ABSENCE_AUDIT = 'ptrp_automaticAbsenceAudit';
const ABSENCE_REQUESTS = 'dp_absenceRequests';
const RECEIPTS = 'repP_receipts';
const ACTIVE_ABSENCE_REQUEST_STATUSES = new Set(['submitted', 'in_review', 'adjustments_requested', 'approved']);
const DEFAULT_ZONE = 'America/Fortaleza';
const MAX_LOOKBACK_DAYS = 45;
const SHIFT_LIMIT = 1000;

export type AutomaticAbsenceRecord = {
  id: string; schemaVersion: 1; workspaceId: string; employeeUid: string; employeeName: string | null;
  unitId: string; workDate: string; shiftId: string; scheduleId: string; shiftEndAt: string; dueAt: string;
  status: 'active'; effect: 'unexcused_absence'; source: 'missing_day_24h'; createdAt: string;
  scheduleSyncStatus?: 'pending_removal' | 'removed' | 'pending_restoration' | 'restored' | 'review_required';
  scheduleSyncVersion?: number;
  displacedShifts?: Array<{ scheduleId: string; shiftId: string; revisionId: string | null; scheduleVersion: number;
    shift: Record<string, unknown> }>;
};

function conflict(): never {
  throw new AppError({ code: 'AUTOMATIC_ABSENCE_RESTORE_REVIEW_REQUIRED', kind: 'CONFLICT',
    safeMessage: 'A escala mudou após a falta. O DP precisa revisar a restauração do turno.' });
}

async function assertRestorationSafe(tx: FirebaseFirestore.Transaction, record: AutomaticAbsenceRecord,
  item: NonNullable<AutomaticAbsenceRecord['displacedShifts']>[number]) {
  const date = record.workDate;
  const from = addDays(date, -13);
  const through = addDays(date, 13);
  const months = [...new Set([from.slice(0, 7), date.slice(0, 7), through.slice(0, 7)])];
  const [legacy, ...revisions] = await Promise.all([
    tx.get(dbAdmin.collectionGroup('shifts').where('userId', '==', record.employeeUid)
      .where('date', '>=', from).where('date', '<=', through).limit(201)),
    ...months.map((month) => readActiveRevisionPersonMonth(tx, record.employeeUid, month)),
  ]);
  if (legacy.size > 200) conflict();
  const legacyScheduleRefs = [...new Map(legacy.docs.map((doc) => doc.ref.parent.parent).filter((ref): ref is FirebaseFirestore.DocumentReference => Boolean(ref))
    .map((ref) => [ref.path, ref] as const)).values()];
  const legacySchedules = legacyScheduleRefs.length ? await tx.getAll(...legacyScheduleRefs) : [];
  const legacyPublished = new Set(legacySchedules.filter((schedule) => schedule.exists && !schedule.get('activeRevisionId')
    && hasPublishedScheduleVersion(schedule.data() ?? {})).map((schedule) => schedule.id));
  const originalIds = new Set((record.displacedShifts ?? []).map((shift) => `${shift.scheduleId}/${shift.shiftId}`));
  const agenda = [
    ...legacy.docs.filter((doc) => doc.ref.path.split('/').length === 4 && legacyPublished.has(doc.ref.parent.parent?.id ?? '')).map((doc) => ({
      key: `${doc.ref.parent.parent?.id}/${doc.id}`, value: doc.data(),
    })),
    ...revisions.flat().map((shift) => ({ key: `${shift.scheduleId}/${shift.id}`, value: shift })),
  ].filter(({ key, value }) => !originalIds.has(key) && (value.type === 'work' || value.type === 'day_off'))
    .map(({ value }) => ({ date: String(value.date), type: value.type as 'work' | 'day_off',
      startTime: String(value.startTime ?? '00:00'), endTime: String(value.endTime ?? '23:59') }));
  const issues = evaluateCoverageAgenda({ date, startTime: String(item.shift.startTime),
    endTime: String(item.shift.endTime) }, agenda);
  if (issues.some((issue) => issue.blocking)) conflict();
  await guardOccupancyWrite(tx, record.workspaceId, shiftOccupancySlices({ beneficiaryUid: record.employeeUid,
    date, startTime: String(item.shift.startTime), endTime: String(item.shift.endTime), addsOccupancy: true }), 2);
}

/** Reconciles the published scale after the HR record is durable. Repeated calls are safe. */
async function reconcilePublishedShifts(record: AutomaticAbsenceRecord, deps: Dependencies) {
  const blockers = await blockingRequests(deps, record.workspaceId, record.employeeUid, record.workDate);
  // An approved absence owns its own schedule displacement; only a corrected punch restores this one.
  const adjustmentSnapshot = await deps.hrDb.collection('ptrp_adjustmentRequests').where('workspaceId', '==', record.workspaceId)
    .where('employeeUid', '==', record.employeeUid).where('workDate', '==', record.workDate).limit(21).get();
  if (adjustmentSnapshot.size > 20) conflict();
  const approvedAdjustment = adjustmentSnapshot.docs.some((doc) => adjustmentRestoresAutomaticAbsence(doc.data()));
  if (approvedAdjustment && blockers.pendingAbsence) conflict();
  const shouldRestore = approvedAdjustment && !blockers.approvedAbsence;
  const shifts = record.displacedShifts ?? [];
  for (const item of shifts) {
    const scheduleRef = deps.mainDb.collection('dp_schedules').doc(item.scheduleId);
    await deps.mainDb.runTransaction(async (tx) => {
      const schedule = await tx.get(scheduleRef);
      if (!schedule.exists || schedule.get('workspaceId') !== record.workspaceId) conflict();
      if ((schedule.get('activeRevisionId') ?? null) !== item.revisionId) {
        if (!shouldRestore && shifts.some((candidate) => candidate.scheduleId === item.scheduleId
          && candidate.revisionId === (schedule.get('activeRevisionId') ?? null))) return;
        conflict();
      }
      const shiftRef = scheduleRef.collection('shifts').doc(item.shiftId);
      const current = item.revisionId ? await readActiveRevisionShift(tx, schedule, item.shiftId)
        : (await tx.get(shiftRef)).data() ?? null;
      const matches = (value: Record<string, unknown> | null) => value?.userId === record.employeeUid
        && value?.date === record.workDate && value?.type === 'work'
        && scheduleShiftFingerprint(value) === scheduleShiftFingerprint(item.shift);
      if (current !== null && !matches(current)) conflict();
      if (shouldRestore ? current !== null : current === null) return;
      if (shouldRestore) {
        const originals = shifts.filter((candidate) => candidate.scheduleId === item.scheduleId
          && candidate.revisionId === item.revisionId);
        const alreadyPresent = (await Promise.all(originals.map(async (candidate) => candidate.shiftId === item.shiftId
          ? null : item.revisionId ? readActiveRevisionShift(tx, schedule, candidate.shiftId)
            : (await tx.get(scheduleRef.collection('shifts').doc(candidate.shiftId))).data() ?? null)))
          .filter((value) => value !== null).length;
        if (item.revisionId && Number(schedule.get('operationalVersion') ?? 0)
          > item.scheduleVersion + originals.length + alreadyPresent) conflict();
        await assertRestorationSafe(tx, record, item);
        if (item.revisionId) {
          (await prepareActiveRevisionOperationalChanges({ tx, schedule, workspaceId: record.workspaceId,
            actorId: 'automatic-absence', reason: 'automatic_absence_corrected',
            changes: [{ shiftId: item.shiftId, previous: null, next: item.shift }] })).apply();
        } else {
          (await preparePublicationFenceAdvance(tx, record.workspaceId, [record.employeeUid])).apply();
          tx.set(shiftRef, item.shift);
          tx.update(scheduleRef, { shiftCount: FieldValue.increment(1), goalEligibilityVersion: FieldValue.increment(1),
            journeyValidationVersion: FieldValue.increment(1) });
        }
      } else if (current) {
        await guardOccupancyWrite(tx, record.workspaceId, shiftOccupancySlices({ beneficiaryUid: record.employeeUid,
          date: record.workDate, startTime: String(item.shift.startTime), endTime: String(item.shift.endTime), addsOccupancy: false }), 2);
        if (item.revisionId) {
          (await prepareActiveRevisionOperationalChanges({ tx, schedule, workspaceId: record.workspaceId,
            actorId: 'automatic-absence', reason: 'automatic_absence_registered',
            changes: [{ shiftId: item.shiftId, previous: current, next: null }] })).apply();
        } else {
          (await preparePublicationFenceAdvance(tx, record.workspaceId, [record.employeeUid])).apply();
          tx.delete(shiftRef);
          tx.update(scheduleRef, { shiftCount: FieldValue.increment(-1), goalEligibilityVersion: FieldValue.increment(1),
            journeyValidationVersion: FieldValue.increment(1) });
        }
      }
    });
  }
  const completed = await deps.hrDb.runTransaction(async (tx) => {
    const ref = deps.hrDb.collection('ptrp_automaticAbsences').doc(record.id);
    const current = await tx.get(ref);
    if (!current.exists || Number(current.get('scheduleSyncVersion') ?? 0) !== Number(record.scheduleSyncVersion ?? 0)) {
      if (current.exists) {
        const status = String(current.get('scheduleSyncStatus') ?? 'pending_removal');
        tx.update(ref, { scheduleSyncStatus: status === 'restored' || status === 'pending_restoration'
          ? 'pending_restoration' : 'pending_removal',
        scheduleSyncVersion: Number(current.get('scheduleSyncVersion') ?? 0) + 1 });
      }
      return false;
    }
    tx.update(ref, { scheduleSyncStatus: shouldRestore ? 'restored' : 'removed', scheduleSyncedAt: deps.now().toISOString(),
      scheduleSyncError: FieldValue.delete() });
    return true;
  });
  if (!completed) throw new AppError({ code: 'AUTOMATIC_ABSENCE_SYNC_RACED', kind: 'CONFLICT',
    safeMessage: 'A correção mudou durante a sincronização; a rotina tentará novamente.' });
  const taskRef = deps.mainDb.collection('dp_responsibilityTasks').doc(`${record.id}_automatic_absence_review`);
  const task = await taskRef.get();
  if (task.exists && task.get('status') !== 'resolved') await taskRef.update({ status: 'resolved',
    resolvedAt: deps.now().toISOString(), resolutionNote: 'Escala reconciliada automaticamente.',
    version: FieldValue.increment(1), updatedAt: deps.now().toISOString() });
}

export async function markAutomaticAbsenceSyncFailure(record: AutomaticAbsenceRecord, error: unknown,
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (error instanceof AppError && error.code === 'AUTOMATIC_ABSENCE_SYNC_RACED') return;
  const message = error instanceof AppError ? error.code : 'AUTOMATIC_ABSENCE_SYNC_FAILED';
  const marked = await deps.hrDb.runTransaction(async (tx) => {
    const ref = deps.hrDb.collection('ptrp_automaticAbsences').doc(record.id);
    const current = await tx.get(ref);
    if (!current.exists || Number(current.get('scheduleSyncVersion') ?? 0) !== Number(record.scheduleSyncVersion ?? 0)) return false;
    tx.update(ref, { scheduleSyncStatus: 'review_required', scheduleSyncError: message,
      scheduleSyncAttemptedAt: deps.now().toISOString() });
    return true;
  });
  if (!marked) return;
  const taskRef = deps.mainDb.collection('dp_responsibilityTasks').doc(`${record.id}_automatic_absence_review`);
  await deps.mainDb.runTransaction(async (tx) => {
    const current = await tx.get(taskRef);
    if (current.exists && current.get('status') !== 'resolved') return;
    const responsibility = await resolveOperationalResponsibility({ transaction: tx, workspaceId: record.workspaceId,
      activity: 'schedules', unitId: record.unitId });
    const assignedUserIds = responsibility.resolution.eligibleUserIds;
    const at = deps.now().toISOString();
    tx.set(taskRef, { id: taskRef.id, workspaceId: record.workspaceId, activity: 'schedules',
      kind: 'automatic_absence_restoration_review', scope: responsibility.scope,
      scopeKey: responsibilityScopeKey(responsibility.scope), unitId: record.unitId,
      requestId: record.id, beneficiaryUid: record.employeeUid, startDate: record.workDate, endDate: record.workDate,
      displacedShiftCount: record.displacedShifts?.length ?? 0,
      status: assignedUserIds.length ? 'pending' : 'unassigned', assignedUserIds,
      assignedLevel: responsibility.resolution.effectiveLevel, coverageVersion: responsibility.resolution.version,
      version: current.exists ? Number(current.get('version') ?? 0) + 1 : 1,
      createdAt: current.exists ? current.get('createdAt') : at, updatedAt: at,
      syncError: message });
  });
}

/** Called by approval as well as the hourly retry job. */
export async function reconcileAutomaticAbsenceForDay(workspaceId: string, uid: string, date: string,
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const record = await deps.hrDb.collection('ptrp_automaticAbsences').doc(automaticAbsenceId(workspaceId, uid, date)).get();
  if (record.exists) {
    try { await reconcilePublishedShifts(record.data() as AutomaticAbsenceRecord, deps); }
    catch (error) { await markAutomaticAbsenceSyncFailure(record.data() as AutomaticAbsenceRecord, error, deps); throw error; }
  }
}

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; now(): Date };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, now: () => new Date() };

const civilDate = (date: Date, timeZone = 'America/Belem') => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const automaticAbsenceId = (workspaceId: string, uid: string, date: string) =>
  createHash('sha256').update(JSON.stringify([workspaceId, uid, date])).digest('hex');

function officialPublishedShift(shift: OfficialShift, schedule: FirebaseFirestore.DocumentSnapshot) {
  return schedule.exists && hasPublishedScheduleVersion(schedule.data() ?? {}) && shift.scheduleId === schedule.id
    && shift.type === 'work' && typeof shift.userId === 'string'
    && typeof shift.startTime === 'string' && typeof shift.endTime === 'string';
}

function snapshotShifts(rows: Array<{ shift: OfficialShift; schedule: FirebaseFirestore.DocumentSnapshot }>) {
  return rows.map(({ shift, schedule }) => ({ scheduleId: schedule.id, shiftId: shift.id,
    revisionId: typeof schedule.get('activeRevisionId') === 'string' ? schedule.get('activeRevisionId') as string : null,
    scheduleVersion: Number(schedule.get('operationalVersion') ?? 0),
    shift: { ...shift } as Record<string, unknown> }));
}

async function hasMarking(deps: Dependencies, workspaceId: string, uid: string, date: string) {
  return !(await deps.repDb.collection(RECEIPTS).where('workspaceId', '==', workspaceId)
    .where('employeeId', '==', uid).where('recordedDate', '==', date).limit(1).get()).empty;
}

async function blockingRequests(deps: Dependencies, workspaceId: string, uid: string, date: string) {
  const [absenceSnapshot, adjustmentSnapshot] = await Promise.all([
    deps.hrDb.collection(ABSENCE_REQUESTS).where('workspaceId', '==', workspaceId)
      .where('beneficiaryUid', '==', uid).where('startDate', '<=', date).limit(101).get(),
    deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId)
      .where('employeeUid', '==', uid).where('workDate', '==', date).limit(21).get(),
  ]);
  if (adjustmentSnapshot.size > 20 || absenceSnapshot.size > 100) conflict();
  const absences = absenceSnapshot.docs.filter((doc) => String(doc.get('endDate')) >= date
    && ACTIVE_ABSENCE_REQUEST_STATUSES.has(String(doc.get('status'))));
  const approvedAbsence = absences.some((doc) => doc.get('status') === 'approved');
  const pendingAbsence = absences.some((doc) => doc.get('status') !== 'approved');
  const adjustment = adjustmentSnapshot.docs.some((doc) => doc.get('status') === 'in_review'
    || adjustmentRestoresAutomaticAbsence(doc.data()));
  return { absence: absences.length > 0, approvedAbsence, pendingAbsence, adjustment };
}

/**
 * Hourly, idempotent registration of unjustified absence after 24 h. A later approved request or adjustment
 * supersedes its payroll/AEJ effect without deleting this audit record.
 */
export async function registerOverdueAutomaticAbsences(workspaceId: string, options: { lookbackDays?: number } = {}, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const now = deps.now();
  // Ten days also backfills recent unresolved days when the automation is first released or briefly unavailable.
  const lookbackDays = Math.min(MAX_LOOKBACK_DAYS, Math.max(2, Math.trunc(options.lookbackDays ?? 10)));
  const end = addDays(civilDate(now), -1);
  const start = addDays(end, -(lookbackDays - 1));
  const months: string[] = [];
  for (let cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    cursor.toISOString().slice(0, 7) <= end.slice(0, 7); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(cursor.toISOString().slice(0, 7));
  }
  const schedules = (await Promise.all(months.map(async (competence) => {
    const snapshot = await deps.mainDb.collection('dp_schedules')
      .where('year', '==', Number(competence.slice(0, 4)))
      .where('month', '==', Number(competence.slice(5, 7))).limit(201).get();
    if (snapshot.size === 201) throw new Error('AUTOMATIC_ABSENCE_SCHEDULE_SCAN_TRUNCATED');
    return snapshot.docs;
  }))).flat();
  const shifts = (await Promise.all(schedules.map(async (schedule) => ({ schedule,
    rows: (await readOfficialScheduleShifts({ scheduleId: schedule.id, db: deps.mainDb })).shifts
      .filter((shift) => typeof shift.date === 'string' && shift.date >= start && shift.date <= end),
  })))).flatMap(({ schedule, rows }) => rows.map((shift) => ({ schedule, shift })));
  if (shifts.length > SHIFT_LIMIT) throw new Error('AUTOMATIC_ABSENCE_SHIFT_SCAN_TRUNCATED');
  const stats = { checked: 0, created: 0, notDue: 0, withMarking: 0, withRequest: 0, closed: 0, invalid: 0 };
  const processed = new Set<string>();
  for (const { shift, schedule } of shifts) {
    stats.checked += 1;
    if (!officialPublishedShift(shift, schedule)) { stats.invalid += 1; continue; }
    const uid = String(shift.userId);
    const date = String(shift.date);
    const unitId = String(shift.unitId ?? schedule.get('unitId') ?? '');
    const [user, unit] = await Promise.all([
      deps.mainDb.collection('users').doc(uid).get(),
      unitId ? deps.mainDb.collection('dp_units').doc(unitId).get() : Promise.resolve(null),
    ]);
    if (!user.exists || user.get('isActive') === false || user.get('workspace_id') && user.get('workspace_id') !== workspaceId) { stats.invalid += 1; continue; }
    const timeZone = unit && isBrazilTimeZone(unit.get('timeZone')) ? unit.get('timeZone') as string : DEFAULT_ZONE;
    const sameDayShifts = shifts.filter((candidate) => candidate.shift.userId === uid && candidate.shift.date === date
      && candidate.shift.type === 'work' && hasPublishedScheduleVersion(candidate.schedule.data() ?? {}));
    const deadline = sameDayShifts.map((candidate) => automaticAbsenceDeadline(date,
      String(candidate.shift.startTime), String(candidate.shift.endTime), candidate.shift.overnight === true, timeZone))
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0];
    if (Date.parse(deadline.dueAt) > now.getTime()) { stats.notDue += 1; continue; }
    const id = automaticAbsenceId(workspaceId, uid, date);
    if (processed.has(id)) continue;
    processed.add(id);
    const target = deps.hrDb.collection(AUTOMATIC_ABSENCES).doc(id);
    const existing = await target.get();
    if (existing.exists) {
      const record = await deps.hrDb.runTransaction(async (tx) => {
        const current = await tx.get(target);
        const value = current.data() as AutomaticAbsenceRecord;
        const saved = value.displacedShifts ?? [];
        const additions = snapshotShifts(sameDayShifts).filter((candidate) => !saved.some((item) =>
          item.scheduleId === candidate.scheduleId && item.shiftId === candidate.shiftId && item.revisionId === candidate.revisionId));
        if (!additions.length || value.scheduleSyncStatus === 'pending_restoration' || value.scheduleSyncStatus === 'restored') return value;
        const displacedShifts = [...saved, ...additions];
        const scheduleSyncVersion = Number(value.scheduleSyncVersion ?? 0) + 1;
        tx.update(target, { displacedShifts, scheduleSyncStatus: 'pending_removal', scheduleSyncVersion });
        return { ...value, displacedShifts, scheduleSyncStatus: 'pending_removal' as const, scheduleSyncVersion };
      });
      try { await reconcilePublishedShifts(record, deps); }
      catch (error) { await markAutomaticAbsenceSyncFailure(record, error, deps); }
      continue;
    }
    const [marking, blockers, closure] = await Promise.all([
      hasMarking(deps, workspaceId, uid, date), blockingRequests(deps, workspaceId, uid, date),
      deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, date)).get(),
    ]);
    if (marking) { stats.withMarking += 1; continue; }
    if (blockers.absence || blockers.adjustment) { stats.withRequest += 1; continue; }
    if (closure.get('status') === 'closed') { stats.closed += 1; continue; }
    const at = now.toISOString();
    const displacedShifts = snapshotShifts(sameDayShifts);
    const value: AutomaticAbsenceRecord = { id, schemaVersion: 1, workspaceId, employeeUid: uid,
      employeeName: typeof user.get('username') === 'string' ? String(user.get('username')).slice(0, 120) : null,
      unitId, workDate: date, shiftId: shift.id, scheduleId: schedule.id, ...deadline,
      status: 'active', effect: 'unexcused_absence', source: 'missing_day_24h', createdAt: at, displacedShifts,
      scheduleSyncStatus: 'pending_removal', scheduleSyncVersion: 1 };
    const created = await deps.hrDb.runTransaction(async (tx) => {
      const [current, absences, adjustments] = await Promise.all([
        tx.get(target),
        tx.get(deps.hrDb.collection(ABSENCE_REQUESTS).where('workspaceId', '==', workspaceId)
          .where('beneficiaryUid', '==', uid).where('startDate', '<=', date).limit(101)),
        tx.get(deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId)
          .where('employeeUid', '==', uid).where('workDate', '==', date).limit(21)),
      ]);
      if (adjustments.size > 20 || absences.size > 100) conflict();
      if (current.exists) return false;
      if (absences.docs.some((doc) => String(doc.get('endDate')) >= date && ACTIVE_ABSENCE_REQUEST_STATUSES.has(String(doc.get('status'))))
        || adjustments.docs.some((doc) => doc.get('status') === 'in_review'
          || adjustmentRestoresAutomaticAbsence(doc.data()))) return false;
      tx.create(target, value);
      tx.create(deps.hrDb.collection(AUTOMATIC_ABSENCE_AUDIT).doc(id), { automaticAbsenceId: id, workspaceId,
        employeeUid: uid, workDate: date, action: 'registered', at, rule: 'missing_day_24h_v1' });
      return true;
    });
    if (created) {
      stats.created += 1;
      try { await reconcilePublishedShifts(value, deps); }
      catch (error) { await markAutomaticAbsenceSyncFailure(value, error, deps); }
    }
    else stats.withRequest += 1;
  }
  // Removed shifts no longer appear in the official scale, so keep reconciling from the durable HR records.
  const pending = await deps.hrDb.collection('ptrp_automaticAbsences').where('workspaceId', '==', workspaceId)
    .where('scheduleSyncStatus', 'in', ['pending_removal', 'pending_restoration', 'review_required']).limit(1001).get();
  if (pending.size > 1000) throw new Error('AUTOMATIC_ABSENCE_RECONCILIATION_SCAN_TRUNCATED');
  for (const record of pending.docs) if (!processed.has(record.id)) {
    try { await reconcilePublishedShifts(record.data() as AutomaticAbsenceRecord, deps); }
    catch (error) { await markAutomaticAbsenceSyncFailure(record.data() as AutomaticAbsenceRecord, error, deps); }
  }
  return { ...stats, start, end, lookbackDays };
}
