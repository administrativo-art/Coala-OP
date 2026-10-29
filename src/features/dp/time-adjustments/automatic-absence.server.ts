import 'server-only';

import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { isBrazilTimeZone } from '@/features/dp/rep-p/time-zones';

import { ADJUSTMENTS, CLOSURES, closureKey } from './service.server';
import { automaticAbsenceDeadline } from './automatic-absence-core';

export const AUTOMATIC_ABSENCES = 'ptrp_automaticAbsences';
const AUTOMATIC_ABSENCE_AUDIT = 'ptrp_automaticAbsenceAudit';
const ABSENCE_REQUESTS = 'dp_absenceRequests';
const RECEIPTS = 'repP_receipts';
const ACTIVE_ABSENCE_REQUEST_STATUSES = new Set(['submitted', 'in_review', 'adjustments_requested', 'approved']);
const ACTIVE_ADJUSTMENT_STATUSES = new Set(['in_review', 'approved']);
const DEFAULT_ZONE = 'America/Fortaleza';
const MAX_LOOKBACK_DAYS = 45;
const SHIFT_LIMIT = 1000;

export type AutomaticAbsenceRecord = {
  id: string; schemaVersion: 1; workspaceId: string; employeeUid: string; employeeName: string | null;
  unitId: string; workDate: string; shiftId: string; scheduleId: string; shiftEndAt: string; dueAt: string;
  status: 'active'; effect: 'unexcused_absence'; source: 'missing_day_24h'; createdAt: string;
};

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; now(): Date };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, now: () => new Date() };

const civilDate = (date: Date, timeZone = 'America/Belem') => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const automaticAbsenceId = (workspaceId: string, uid: string, date: string) =>
  createHash('sha256').update(JSON.stringify([workspaceId, uid, date])).digest('hex');

function officialLockedShift(shift: QueryDocumentSnapshot, schedule: FirebaseFirestore.DocumentSnapshot) {
  return schedule.exists && schedule.get('locked') === true && shift.ref.parent.parent?.id === schedule.id
    && shift.get('type') === 'work' && typeof shift.get('userId') === 'string'
    && typeof shift.get('startTime') === 'string' && typeof shift.get('endTime') === 'string';
}

async function hasMarking(deps: Dependencies, workspaceId: string, uid: string, date: string) {
  return !(await deps.repDb.collection(RECEIPTS).where('workspaceId', '==', workspaceId)
    .where('employeeId', '==', uid).where('recordedDate', '==', date).limit(1).get()).empty;
}

async function blockingRequests(deps: Dependencies, workspaceId: string, uid: string, date: string) {
  const [absenceSnapshot, adjustmentSnapshot] = await Promise.all([
    deps.hrDb.collection(ABSENCE_REQUESTS).where('workspaceId', '==', workspaceId)
      .where('beneficiaryUid', '==', uid).where('startDate', '<=', date).limit(100).get(),
    deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId)
      .where('employeeUid', '==', uid).where('workDate', '==', date).limit(20).get(),
  ]);
  const absence = absenceSnapshot.docs.some((doc) => String(doc.get('endDate')) >= date
    && ACTIVE_ABSENCE_REQUEST_STATUSES.has(String(doc.get('status'))));
  const adjustment = adjustmentSnapshot.docs.some((doc) => ACTIVE_ADJUSTMENT_STATUSES.has(String(doc.get('status'))));
  return { absence, adjustment };
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
  const shifts = await deps.mainDb.collectionGroup('shifts').where('date', '>=', start).where('date', '<=', end)
    .orderBy('date').limit(SHIFT_LIMIT + 1).get();
  if (shifts.size > SHIFT_LIMIT) throw new Error('AUTOMATIC_ABSENCE_SHIFT_SCAN_TRUNCATED');
  const stats = { checked: 0, created: 0, notDue: 0, withMarking: 0, withRequest: 0, closed: 0, invalid: 0 };
  for (const shift of shifts.docs) {
    stats.checked += 1;
    const scheduleRef = shift.ref.parent.parent;
    if (!scheduleRef) { stats.invalid += 1; continue; }
    const schedule = await scheduleRef.get();
    if (!officialLockedShift(shift, schedule)) { stats.invalid += 1; continue; }
    const uid = String(shift.get('userId'));
    const date = String(shift.get('date'));
    const unitId = String(shift.get('unitId') ?? schedule.get('unitId') ?? '');
    const [user, unit] = await Promise.all([
      deps.mainDb.collection('users').doc(uid).get(),
      unitId ? deps.mainDb.collection('dp_units').doc(unitId).get() : Promise.resolve(null),
    ]);
    if (!user.exists || user.get('isActive') === false || user.get('workspace_id') && user.get('workspace_id') !== workspaceId) { stats.invalid += 1; continue; }
    const timeZone = unit && isBrazilTimeZone(unit.get('timeZone')) ? unit.get('timeZone') as string : DEFAULT_ZONE;
    const deadline = automaticAbsenceDeadline(date, String(shift.get('startTime')), String(shift.get('endTime')), shift.get('overnight') === true, timeZone);
    if (Date.parse(deadline.dueAt) > now.getTime()) { stats.notDue += 1; continue; }
    const id = automaticAbsenceId(workspaceId, uid, date);
    const target = deps.hrDb.collection(AUTOMATIC_ABSENCES).doc(id);
    if ((await target.get()).exists) continue;
    const [marking, blockers, closure] = await Promise.all([
      hasMarking(deps, workspaceId, uid, date), blockingRequests(deps, workspaceId, uid, date),
      deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, date)).get(),
    ]);
    if (marking) { stats.withMarking += 1; continue; }
    if (blockers.absence || blockers.adjustment) { stats.withRequest += 1; continue; }
    if (closure.get('status') === 'closed') { stats.closed += 1; continue; }
    const at = now.toISOString();
    const value: AutomaticAbsenceRecord = { id, schemaVersion: 1, workspaceId, employeeUid: uid,
      employeeName: typeof user.get('username') === 'string' ? String(user.get('username')).slice(0, 120) : null,
      unitId, workDate: date, shiftId: shift.id, scheduleId: schedule.id, ...deadline,
      status: 'active', effect: 'unexcused_absence', source: 'missing_day_24h', createdAt: at };
    const created = await deps.hrDb.runTransaction(async (tx) => {
      const [current, absences, adjustments] = await Promise.all([
        tx.get(target),
        tx.get(deps.hrDb.collection(ABSENCE_REQUESTS).where('workspaceId', '==', workspaceId)
          .where('beneficiaryUid', '==', uid).where('startDate', '<=', date).limit(100)),
        tx.get(deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId)
          .where('employeeUid', '==', uid).where('workDate', '==', date).limit(20)),
      ]);
      if (current.exists) return false;
      if (absences.docs.some((doc) => String(doc.get('endDate')) >= date && ACTIVE_ABSENCE_REQUEST_STATUSES.has(String(doc.get('status'))))
        || adjustments.docs.some((doc) => ACTIVE_ADJUSTMENT_STATUSES.has(String(doc.get('status'))))) return false;
      tx.create(target, value);
      tx.create(deps.hrDb.collection(AUTOMATIC_ABSENCE_AUDIT).doc(id), { automaticAbsenceId: id, workspaceId,
        employeeUid: uid, workDate: date, action: 'registered', at, rule: 'missing_day_24h_v1' });
      return true;
    });
    if (created) stats.created += 1; else stats.withRequest += 1;
  }
  return { ...stats, start, end, lookbackDays };
}
