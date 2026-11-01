import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, type Transaction, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { prepareActiveRevisionOperationalChanges, readActiveRevisionPersonMonth } from '@/features/dp/schedules/operational-overlay.server';
import { preparePublicationFenceAdvance } from '@/features/dp/schedules/publication-fence.server';

import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import type { ServerUserContext } from '@/lib/auth-server';
import { canAccessUnit } from '@/lib/unit-access';
import type { AbsenceRequestRecord } from '../requests/workflow-types';
import { absenceCivilDateSchema } from '../requests/schemas';
import { createResponsibilityTaskNotifications, resolveGapAlertRecipients,
  resolveOperationalResponsibility, responsibilityScopeKey } from '@/features/dp/responsibility-coverage/service.server';
import { operationalDayRefs, operationalGuardRequested, operationalReadinessRef, operationalReadinessValid,
  type OccupancySlice, shiftOccupancySlices } from './occupancy-guard.server';

const intents = hrDbAdmin.collection('dp_absenceOperationalIntents');
const requests = hrDbAdmin.collection('dp_absenceRequests');
const operationalAudit = hrDbAdmin.collection('dp_absenceOperationalAudit');
const fail = (code: string) => new AppError({ code, kind: 'CONFLICT',
  safeMessage: 'A disponibilidade operacional mudou ou não pôde ser comprovada. Revise a escala antes de decidir.' });
const overlap = (a: Pick<OccupancySlice, 'fromMinute' | 'toMinute'>,
  b: Pick<OccupancySlice, 'fromMinute' | 'toMinute'>) => a.fromMinute < b.toMinute && b.fromMinute < a.toMinute;

export type OperationalIntent = { requestId: string; workspaceId: string; beneficiaryUid: string; unitId: string;
  expectedVersion: number; revision: number; operationId: string; actionHash: string; actorUid: string;
  fenceId: string; status: 'begun' | 'prepared' | 'abort_requested' | 'committed' | 'active' | 'reversed' | 'aborted';
  blocksSchedule: boolean; segments: OccupancySlice[]; createdAt: string; epoch?: string };
async function revisionShiftsForAbsence(tx: Transaction, intent: OperationalIntent, prior: string) {
  const months = [...new Set([prior.slice(0, 7), ...intent.segments.map((segment) => segment.date.slice(0, 7))])];
  if (months.length > 7) throw fail('ABSENCE_OPERATIONAL_PERIOD_LIMIT');
  const rows = (await Promise.all(months.map((month) =>
    readActiveRevisionPersonMonth(tx, intent.beneficiaryUid, month)))).flat();
  const last = intent.segments.at(-1)?.date ?? prior;
  return rows.filter((shift) => typeof shift.date === 'string' && shift.date >= prior && shift.date <= last);
}

async function legacyShiftDocuments(tx: Transaction, documents: QueryDocumentSnapshot[]) {
  const scheduleRefs = [...new Map(documents.flatMap((document) => {
    const schedule = document.ref.parent.parent;
    return schedule?.parent.id === 'dp_schedules' ? [[schedule.path, schedule] as const] : [];
  })).values()];
  const schedules = scheduleRefs.length ? await tx.getAll(...scheduleRefs) : [];
  const active = new Set(schedules.filter((schedule) => schedule.get('activeRevisionId')).map((schedule) => schedule.ref.path));
  return documents.filter((document) => !active.has(document.ref.parent.parent?.path ?? ''));
}

export const operationalIntentRef = (requestId: string, expectedVersion: number) =>
  intents.doc(`${requestId}_${expectedVersion + 1}`);
const coalaFenceRef = (requestId: string) => dbAdmin.collection('dp_absenceOperationalFences').doc(requestId);
export const coalaAvailabilityRef = (requestId: string) =>
  dbAdmin.collection('dp_absenceOperationalAvailability').doc(requestId);

function availabilityProjection(intent: OperationalIntent, epoch: string, state: 'prepared' | 'active' | 'tombstone') {
  const monthKeys = [...new Set(intent.segments.map((segment) => segment.date.slice(0, 7)))];
  return { requestId: intent.requestId, workspaceId: intent.workspaceId, beneficiaryUid: intent.beneficiaryUid,
    unitId: intent.unitId, requestVersion: intent.expectedVersion + 1, revision: intent.revision,
    fenceId: intent.fenceId, epoch, state, blocksSchedule: intent.blocksSchedule,
    startDate: intent.segments[0].date, endDate: intent.segments[intent.segments.length - 1].date,
    monthKeys, intervals: intent.segments.map(({ date, fromMinute, toMinute }) => ({ date, fromMinute, toMinute })),
    updatedAt: new Date().toISOString() };
}

function checkedSlices(value: AbsenceRequestRecord): OccupancySlice[] {
  if (!value.segments.length || value.segments.length > 180) throw fail('ABSENCE_OPERATIONAL_SEGMENTS_INVALID');
  let previous = '';
  return value.segments.map((segment) => {
    if (!absenceCivilDateSchema.safeParse(segment.date).success || segment.date <= previous
      || !Number.isInteger(segment.fromMinute) || !Number.isInteger(segment.toMinute)
      || segment.fromMinute < 0 || segment.toMinute > 1440 || segment.fromMinute >= segment.toMinute) {
      throw fail('ABSENCE_OPERATIONAL_SEGMENTS_INVALID');
    }
    previous = segment.date;
    return { beneficiaryUid: value.beneficiaryUid, date: segment.date,
      fromMinute: segment.fromMinute, toMinute: segment.toMinute, addsOccupancy: false };
  });
}

export async function beginOperationalIntent(value: AbsenceRequestRecord, actorUid: string,
  operationId: string, actionHash: string): Promise<OperationalIntent> {
  const ref = operationalIntentRef(value.id, value.version);
  const segments = checkedSlices(value);
  return hrDbAdmin.runTransaction(async (tx) => {
    const [requestDoc, existing] = await Promise.all([tx.get(requests.doc(value.id)), tx.get(ref)]);
    if (!requestDoc.exists || requestDoc.get('workspaceId') !== value.workspaceId
      || requestDoc.get('version') !== value.version || requestDoc.get('revision') !== value.revision
      || requestDoc.get('status') !== value.status) throw fail('ABSENCE_OPERATIONAL_REQUEST_CHANGED');
    const pending = requestDoc.get('operationalPending');
    if (pending && (pending.operationId !== operationId || pending.actorUid !== actorUid
      || pending.actionHash !== actionHash || pending.expectedVersion !== value.version)) {
      throw fail('ABSENCE_OPERATIONAL_INTENT_CONFLICT');
    }
    if (existing.exists) {
      const found = existing.data() as OperationalIntent;
      if (found.operationId !== operationId || found.actorUid !== actorUid
        || found.actionHash !== actionHash
        || found.expectedVersion !== value.version || found.revision !== value.revision
        || found.workspaceId !== value.workspaceId || found.beneficiaryUid !== value.beneficiaryUid
        || found.status === 'aborted' || !pending) {
        throw fail('ABSENCE_OPERATIONAL_INTENT_CONFLICT');
      }
      return found;
    }
    const intent: OperationalIntent = { requestId: value.id, workspaceId: value.workspaceId,
      beneficiaryUid: value.beneficiaryUid, unitId: value.unitId, expectedVersion: value.version,
      revision: value.revision, operationId, actionHash, actorUid, fenceId: operationId, status: 'begun',
      blocksSchedule: value.typeSnapshot.blocksSchedule === true, segments, createdAt: new Date().toISOString() };
    tx.create(ref, intent);
    tx.update(requests.doc(value.id), { operationalPending: { operationId, expectedVersion: value.version,
      actionHash, actorUid } });
    return intent;
  });
}

/** The Coala transaction observes bounded shifts/vacations and fences the same person-days their writers touch. */
export async function prepareOperationalAbsence(intent: OperationalIntent) {
  if (intent.status === 'reversed') throw fail('ABSENCE_OPERATIONAL_INTENT_REVERSED');
  const first = intent.segments[0]?.date;
  const last = intent.segments.at(-1)?.date;
  if (!first || !last || intent.segments.length > 180) throw fail('ABSENCE_OPERATIONAL_SEGMENTS_INVALID');
  const prior = new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const shiftQuery = dbAdmin.collectionGroup('shifts').where('userId', '==', intent.beneficiaryUid)
    .where('date', '>=', prior).where('date', '<=', last).orderBy('date').limit(201);
  const vacationQuery = dbAdmin.collection('dp_vacations').where('userId', '==', intent.beneficiaryUid)
    .where('status', '==', 'APPROVED').where('recordType', '==', 'gozo')
    .where('endDate', '>=', first).where('startDate', '<=', last)
    .orderBy('endDate').orderBy('startDate').limit(51);
  return dbAdmin.runTransaction(async (tx) => {
    const revisionShifts = await revisionShiftsForAbsence(tx, intent, prior);
    const readiness = await tx.get(operationalReadinessRef(intent.workspaceId));
    if (!operationalReadinessValid(readiness, intent.workspaceId)) throw fail('ABSENCE_OPERATIONAL_NOT_READY');
    const epoch = readiness.get('epoch') as string;
    const fenceRef = coalaFenceRef(intent.requestId);
    const availabilityRef = coalaAvailabilityRef(intent.requestId);
    const [fence, availability] = await Promise.all([tx.get(fenceRef), tx.get(availabilityRef)]);
    if (fence.exists !== availability.exists) throw fail('ABSENCE_OPERATIONAL_AVAILABILITY_CHANGED');
    const replacesTombstone = fence.exists && fence.get('state') === 'tombstone'
      && Number.isSafeInteger(fence.get('requestVersion'))
      && fence.get('requestVersion') < intent.expectedVersion + 1;
    if (fence.exists && (fence.get('workspaceId') !== intent.workspaceId
      || fence.get('beneficiaryUid') !== intent.beneficiaryUid || fence.get('epoch') !== epoch
      || !replacesTombstone && (fence.get('fenceId') !== intent.fenceId
        || fence.get('requestVersion') !== intent.expectedVersion + 1
        || !['prepared', 'active'].includes(String(fence.get('state')))))) {
      throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
    }
    if (availability.exists && (availability.get('workspaceId') !== intent.workspaceId
      || availability.get('beneficiaryUid') !== intent.beneficiaryUid
      || availability.get('epoch') !== epoch
      || !replacesTombstone && (availability.get('fenceId') !== intent.fenceId
        || availability.get('requestVersion') !== intent.expectedVersion + 1
        || !['prepared', 'active'].includes(String(availability.get('state')))))) {
      throw fail('ABSENCE_OPERATIONAL_AVAILABILITY_CHANGED');
    }
    const [shifts, vacations] = await Promise.all([tx.get(shiftQuery), tx.get(vacationQuery)]);
    if (shifts.size === 201 || vacations.size === 51) throw fail('ABSENCE_OPERATIONAL_QUERY_LIMIT');
    const legacyShifts = await legacyShiftDocuments(tx, shifts.docs);
    if (vacations.docs.some((doc) => !absenceCivilDateSchema.safeParse(doc.get('startDate')).success
      || !absenceCivilDateSchema.safeParse(doc.get('endDate')).success
      || String(doc.get('startDate')) > String(doc.get('endDate')))) {
      throw fail('ABSENCE_OPERATIONAL_VACATION_INVALID');
    }
    if (vacations.size > 0) throw fail('ABSENCE_OPERATIONAL_VACATION_CONFLICT');
    for (const shift of [...legacyShifts.map((document) => ({
      type: document.get('type'), date: document.get('date'), startTime: document.get('startTime'),
      endTime: document.get('endTime'), scheduleId: document.ref.parent.parent?.id,
    })), ...revisionShifts]) {
      if (shift.type === 'day_off') continue;
      if (shift.type !== 'work') throw fail('ABSENCE_OPERATIONAL_SHIFT_INVALID');
      shiftOccupancySlices({ beneficiaryUid: intent.beneficiaryUid,
        date: String(shift.date ?? ''), startTime: shift.startTime as string,
        endTime: shift.endTime as string, addsOccupancy: false });
    }
    const refs = intent.segments.map((segment) => ({ segment,
      ...operationalDayRefs(intent.workspaceId, intent.beneficiaryUid, segment.date) }));
    const snapshots = await Promise.all(refs.map(async ({ clock, marker }) => ({
      clock: await tx.get(clock), marker: await tx.get(marker),
    })));
    const publicationFence = await preparePublicationFenceAdvance(tx, intent.workspaceId, [intent.beneficiaryUid]);
    publicationFence.apply();
    snapshots.forEach(({ clock, marker }, index) => {
      const segment = refs[index].segment;
      if (clock.exists && (clock.get('epoch') !== epoch || clock.get('workspaceId') !== intent.workspaceId
        || clock.get('beneficiaryUid') !== intent.beneficiaryUid || clock.get('date') !== segment.date
        || !Number.isSafeInteger(clock.get('version')) || clock.get('version') >= Number.MAX_SAFE_INTEGER)) {
        throw fail('ABSENCE_OPERATIONAL_CLOCK_INVALID');
      }
      if (marker.exists && (marker.get('epoch') !== epoch || marker.get('workspaceId') !== intent.workspaceId
        || marker.get('beneficiaryUid') !== intent.beneficiaryUid || marker.get('date') !== segment.date)) {
        throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
      }
      const entries = marker.exists ? marker.get('entries') : [];
      if (!Array.isArray(entries) || entries.length > 20) throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
      for (const entry of entries) {
        if (!entry || typeof entry.requestId !== 'string' || typeof entry.fenceId !== 'string'
          || !Number.isSafeInteger(entry.requestVersion) || entry.requestVersion < 1
          || typeof entry.blocksSchedule !== 'boolean'
          || !Number.isInteger(entry.fromMinute) || !Number.isInteger(entry.toMinute)
          || entry.fromMinute < 0 || entry.toMinute > 1440 || entry.fromMinute >= entry.toMinute
          || !['prepared', 'active', 'tombstone'].includes(entry.state)) throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
        if (entry.requestId === intent.requestId && entry.state !== 'tombstone'
          && (entry.fenceId !== intent.fenceId || entry.requestVersion !== intent.expectedVersion + 1)) {
          throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
        }
        if (entry.requestId !== intent.requestId && intent.blocksSchedule && entry.blocksSchedule
          && entry.state !== 'tombstone' && overlap(segment, entry)) throw fail('ABSENCE_OPERATIONAL_MARKER_CONFLICT');
      }
      const own = entries.find((entry) => entry.requestId === intent.requestId
        && entry.fenceId === intent.fenceId && entry.requestVersion === intent.expectedVersion + 1);
      if (own && own.state !== 'prepared' && own.state !== 'active') throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
      const liveEntries = entries.filter((entry) => entry.state !== 'tombstone');
      const next = own ? liveEntries : [...liveEntries, { requestId: intent.requestId,
        requestVersion: intent.expectedVersion + 1, fenceId: intent.fenceId,
        fromMinute: segment.fromMinute, toMinute: segment.toMinute,
        blocksSchedule: intent.blocksSchedule, state: 'prepared' }];
      if (next.length > 20) throw fail('ABSENCE_OPERATIONAL_MARKER_LIMIT');
      tx.set(refs[index].marker, { workspaceId: intent.workspaceId, beneficiaryUid: intent.beneficiaryUid,
        date: segment.date, epoch, entries: next, updatedAt: new Date().toISOString() });
      tx.set(refs[index].clock, { workspaceId: intent.workspaceId, beneficiaryUid: intent.beneficiaryUid,
        date: segment.date, epoch, version: (clock.exists ? clock.get('version') as number : 0) + 1,
        updatedAt: new Date().toISOString() });
    });
    tx.set(fenceRef, { requestId: intent.requestId, workspaceId: intent.workspaceId,
      beneficiaryUid: intent.beneficiaryUid, requestVersion: intent.expectedVersion + 1,
      fenceId: intent.fenceId, epoch, state: replacesTombstone ? 'prepared' : fence.exists ? fence.get('state') : 'prepared',
      updatedAt: new Date().toISOString() });
    tx.set(availabilityRef, availabilityProjection(intent, epoch,
      replacesTombstone ? 'prepared' : availability.exists ? availability.get('state') as 'prepared' | 'active' : 'prepared'));
    return { prepared: true as const, epoch, days: refs.length };
  });
}

export async function markOperationalIntentPrepared(intent: OperationalIntent, epoch: string) {
  const ref = operationalIntentRef(intent.requestId, intent.expectedVersion);
  await hrDbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get('fenceId') !== intent.fenceId) throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    if (snapshot.get('status') === 'prepared' || snapshot.get('status') === 'committed') {
      if (snapshot.get('epoch') !== epoch) throw fail('ABSENCE_OPERATIONAL_EPOCH_CHANGED');
      return;
    }
    if (snapshot.get('status') !== 'begun') throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    tx.update(ref, { status: 'prepared', epoch, preparedAt: new Date().toISOString() });
  });
}

/** Never turns a tombstone back into an active marker, even on old retries. */
export async function activateOperationalAbsence(intent: OperationalIntent) {
  const request = await requests.doc(intent.requestId).get();
  if (!request.exists || request.get('status') !== 'approved'
    || request.get('version') !== intent.expectedVersion + 1) throw fail('ABSENCE_OPERATIONAL_DECISION_CHANGED');
  const first = intent.segments[0]?.date;
  const last = intent.segments.at(-1)?.date;
  if (!first || !last) throw fail('ABSENCE_OPERATIONAL_SEGMENTS_INVALID');
  const prior = new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const shiftQuery = dbAdmin.collectionGroup('shifts').where('userId', '==', intent.beneficiaryUid)
    .where('date', '>=', prior).where('date', '<=', last).orderBy('date').limit(201);
  await dbAdmin.runTransaction(async (tx) => {
    const revisionShifts = await revisionShiftsForAbsence(tx, intent, prior);
    const readiness = await tx.get(operationalReadinessRef(intent.workspaceId));
    if (!operationalReadinessValid(readiness, intent.workspaceId)) throw fail('ABSENCE_OPERATIONAL_NOT_READY');
    const fenceRef = coalaFenceRef(intent.requestId);
    const availabilityRef = coalaAvailabilityRef(intent.requestId);
    const [fence, availability] = await Promise.all([tx.get(fenceRef), tx.get(availabilityRef)]);
    if (!fence.exists || fence.get('fenceId') !== intent.fenceId
      || fence.get('requestVersion') !== intent.expectedVersion + 1
      || fence.get('epoch') !== readiness.get('epoch')
      || !['prepared', 'active'].includes(String(fence.get('state')))) throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
    if (!availability.exists || availability.get('fenceId') !== intent.fenceId
      || availability.get('requestVersion') !== intent.expectedVersion + 1
      || availability.get('epoch') !== readiness.get('epoch')
      || availability.get('state') !== fence.get('state')) throw fail('ABSENCE_OPERATIONAL_AVAILABILITY_CHANGED');
    const refs = intent.segments.map((segment) => operationalDayRefs(intent.workspaceId, intent.beneficiaryUid, segment.date));
    const [snapshots, allShifts] = await Promise.all([
      Promise.all(refs.map(({ marker, clock }) => Promise.all([tx.get(marker), tx.get(clock)]))),
      tx.get(shiftQuery),
    ]);
    if (allShifts.size === 201) throw fail('ABSENCE_OPERATIONAL_QUERY_LIMIT');
    const legacyShifts = await legacyShiftDocuments(tx, allShifts.docs);
    const prepared = snapshots.map(([snapshot, clock]) => {
      if (!snapshot.exists || snapshot.get('epoch') !== readiness.get('epoch')
        || !clock.exists || clock.get('epoch') !== readiness.get('epoch')
        || !Number.isSafeInteger(clock.get('version')) || clock.get('version') >= Number.MAX_SAFE_INTEGER) {
        throw fail('ABSENCE_OPERATIONAL_MARKER_MISSING');
      }
      const entries = snapshot.get('entries');
      if (!Array.isArray(entries)) throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
      const own = entries.find((entry) => entry?.requestId === intent.requestId
        && entry?.fenceId === intent.fenceId && entry?.requestVersion === intent.expectedVersion + 1);
      if (!own || own.fenceId !== intent.fenceId || own.state === 'tombstone') throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
      return { entries, own, clock };
    });
    if (fence.get('state') === 'active' && prepared.every(({ own }) => own.state === 'active')) return;
    const candidates = [
      ...legacyShifts.map((shift) => ({ id: shift.id, ref: shift.ref,
        data: shift.data() ?? {}, revision: false })),
      ...revisionShifts.map((shift) => ({ id: shift.id,
        ref: dbAdmin.collection('dp_schedules').doc(shift.scheduleId).collection('shifts').doc(shift.id),
        data: shift as Record<string, unknown>, revision: true })),
    ];
    const displaced = intent.blocksSchedule ? candidates.filter((shift) => {
      if (shift.data.type === 'day_off') return false;
      if (shift.data.type !== 'work') throw fail('ABSENCE_OPERATIONAL_SHIFT_INVALID');
      const segments = shiftOccupancySlices({ beneficiaryUid: intent.beneficiaryUid,
        date: String(shift.data.date ?? ''), startTime: shift.data.startTime as string,
        endTime: shift.data.endTime as string, addsOccupancy: false });
      return segments.some((segment) => intent.segments.some((absence) => segment.date === absence.date
        && overlap(segment, absence)));
    }) : [];
    const scheduleRefs = [...new Map(displaced.map((shift) => {
      const schedule = shift.ref.parent.parent;
      if (!schedule || schedule.parent.id !== 'dp_schedules') throw fail('ABSENCE_OPERATIONAL_SHIFT_INVALID');
      return [schedule.path, schedule] as const;
    })).values()];
    const scheduleDocuments = await Promise.all(scheduleRefs.map((reference) => tx.get(reference)));
    const taskRef = dbAdmin.collection('dp_responsibilityTasks').doc(`${intent.requestId}_schedule_recomposition`);
    const task = displaced.length ? await tx.get(taskRef) : null;
    const responsibility = displaced.length ? await resolveOperationalResponsibility({ transaction: tx,
      workspaceId: intent.workspaceId, activity: 'schedules', unitId: intent.unitId }) : null;
    const gapRecipients = responsibility && !responsibility.resolution.eligibleUserIds.length
      ? await resolveGapAlertRecipients(tx) : [];
    if (task?.exists && (task.get('requestId') !== intent.requestId || task.get('kind') !== 'absence_schedule_recomposition')) {
      throw fail('ABSENCE_OPERATIONAL_TASK_CHANGED');
    }
    const countsBySchedule = new Map<string, number>();
    displaced.forEach((shift) => {
      const schedule = shift.ref.parent.parent!;
      countsBySchedule.set(schedule.path, (countsBySchedule.get(schedule.path) ?? 0) + 1);
    });
    scheduleDocuments.forEach((schedule) => {
      const removed = countsBySchedule.get(schedule.ref.path) ?? 0;
      const current = Number(schedule.get('shiftCount'));
      if (!schedule.exists || schedule.get('workspaceId') !== intent.workspaceId
        || !Number.isSafeInteger(current) || current < removed) throw fail('ABSENCE_OPERATIONAL_SCHEDULE_INVALID');
    });
    const overlayPreparations = await Promise.all(scheduleDocuments.filter((schedule) => schedule.get('activeRevisionId'))
      .map((schedule) => prepareActiveRevisionOperationalChanges({ tx, schedule, workspaceId: intent.workspaceId, actorId: intent.actorUid,
        reason: 'absence_activated', changes: displaced.filter((shift) => shift.ref.parent.parent?.path === schedule.ref.path)
          .map((shift) => ({ shiftId: shift.id, previous: shift.data, next: null })) })));
    const publicationFence = displaced.length && !overlayPreparations.length
      ? await preparePublicationFenceAdvance(tx, intent.workspaceId, [intent.beneficiaryUid]) : null;
    const now = new Date().toISOString();
    publicationFence?.apply();
    prepared.forEach(({ entries, own, clock }, index) => {
      tx.update(refs[index].marker, { entries: entries.map((entry) => entry === own ? { ...entry, state: 'active' } : entry),
        updatedAt: now });
      tx.update(refs[index].clock, { version: (clock.get('version') as number) + 1,
        updatedAt: now });
    });
    displaced.forEach((shift) => {
      const archiveId = createHash('sha256').update(`${intent.requestId}:${shift.ref.path}`).digest('hex');
      tx.create(dbAdmin.collection('dp_absenceDisplacedShifts').doc(archiveId), {
        requestId: intent.requestId, workspaceId: intent.workspaceId, beneficiaryUid: intent.beneficiaryUid,
        unitId: intent.unitId, fenceId: intent.fenceId, requestVersion: intent.expectedVersion + 1,
        originalPath: shift.ref.path, scheduleId: shift.ref.parent.parent!.id, shiftId: shift.id,
        ...(shift.revision ? { officialRevisionId: scheduleDocuments.find((schedule) => schedule.id === shift.ref.parent.parent!.id)!.get('activeRevisionId') } : {}),
        shift: shift.data, displacedAt: now,
      });
      if (!shift.revision) tx.delete(shift.ref);
    });
    overlayPreparations.forEach((preparedOverlay) => preparedOverlay.apply());
    scheduleDocuments.filter((schedule) => !schedule.get('activeRevisionId')).forEach((schedule) => {
      const removed = countsBySchedule.get(schedule.ref.path) ?? 0;
      tx.update(schedule.ref, { shiftCount: Number(schedule.get('shiftCount')) - removed,
        goalEligibilityVersion: FieldValue.increment(1), journeyValidationVersion: FieldValue.increment(1) });
    });
    if (displaced.length && responsibility) {
      const assignedUserIds = responsibility.resolution.eligibleUserIds;
      const taskVersion = task?.exists ? Number(task.get('version')) + 1 : 1;
      const taskStatus = assignedUserIds.length ? 'pending' : 'unassigned';
      const taskPayload = { id: taskRef.id, workspaceId: intent.workspaceId, activity: 'schedules',
        kind: 'absence_schedule_recomposition', scope: responsibility.scope,
        scopeKey: responsibilityScopeKey(responsibility.scope), unitId: intent.unitId,
        requestId: intent.requestId, beneficiaryUid: intent.beneficiaryUid,
        startDate: first, endDate: last, displacedShiftCount: displaced.length,
        status: taskStatus, assignedUserIds, assignedLevel: responsibility.resolution.effectiveLevel,
        coverageVersion: responsibility.resolution.version, version: taskVersion,
        createdAt: task?.exists ? task.get('createdAt') : now, updatedAt: now };
      if (task?.exists) tx.set(taskRef, taskPayload, { merge: false });
      else tx.create(taskRef, taskPayload);
      createResponsibilityTaskNotifications(tx, { taskId: taskRef.id, taskVersion,
        workspaceId: intent.workspaceId, recipients: assignedUserIds.length ? assignedUserIds : gapRecipients,
        unassigned: !assignedUserIds.length });
      tx.create(dbAdmin.collection('dp_responsibilityTaskAudit').doc(`${taskRef.id}_${taskVersion}`), {
        workspaceId: intent.workspaceId, taskId: taskRef.id, version: taskVersion,
        action: 'created_from_approved_absence', actorUid: intent.actorUid, at: now,
        displacedShiftCount: displaced.length,
      });
    }
    tx.create(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: intent.workspaceId, user_id: intent.actorUid, username: null,
      module: 'dp.absences', action: 'absence_activated_on_schedule',
      metadata: { request_id: intent.requestId, beneficiary_uid: intent.beneficiaryUid,
        displaced_shift_count: displaced.length, schedule_ids: scheduleRefs.map((reference) => reference.id) },
      ip_address: null, timestamp: FieldValue.serverTimestamp(),
      ttl: new Date(Date.now() + 365 * 86_400_000),
    });
    tx.update(fenceRef, { state: 'active', displacedShiftCount: displaced.length,
      responsibilityTaskId: displaced.length ? taskRef.id : null, updatedAt: now });
    tx.update(availabilityRef, { state: 'active', displacedShiftCount: displaced.length,
      responsibilityTaskId: displaced.length ? taskRef.id : null, updatedAt: now });
  });
}

export async function reverseOperationalAbsence(intent: OperationalIntent) {
  await dbAdmin.runTransaction(async (tx) => {
    const readiness = await tx.get(operationalReadinessRef(intent.workspaceId));
    if (!operationalReadinessValid(readiness, intent.workspaceId)) throw fail('ABSENCE_OPERATIONAL_NOT_READY');
    const fenceRef = coalaFenceRef(intent.requestId);
    const availabilityRef = coalaAvailabilityRef(intent.requestId);
    const [fence, availability] = await Promise.all([tx.get(fenceRef), tx.get(availabilityRef)]);
    if (!fence.exists || fence.get('fenceId') !== intent.fenceId
      || fence.get('requestVersion') !== intent.expectedVersion + 1
      || fence.get('epoch') !== readiness.get('epoch')
      || !['prepared', 'active', 'tombstone'].includes(String(fence.get('state')))) {
      throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
    }
    if (!availability.exists || availability.get('fenceId') !== intent.fenceId
      || availability.get('requestVersion') !== intent.expectedVersion + 1
      || availability.get('epoch') !== readiness.get('epoch')
      || availability.get('state') !== fence.get('state')) throw fail('ABSENCE_OPERATIONAL_AVAILABILITY_CHANGED');
    const refs = intent.segments.map((segment) => operationalDayRefs(intent.workspaceId, intent.beneficiaryUid, segment.date));
    const snapshots = await Promise.all(refs.map(({ marker, clock }) =>
      Promise.all([tx.get(marker), tx.get(clock)])));
    const prepared = snapshots.map(([marker, clock], index) => {
      const segment = intent.segments[index];
      if (!marker.exists || marker.get('workspaceId') !== intent.workspaceId
        || marker.get('beneficiaryUid') !== intent.beneficiaryUid || marker.get('date') !== segment.date
        || marker.get('epoch') !== readiness.get('epoch')
        || clock.exists && (clock.get('epoch') !== readiness.get('epoch')
          || !Number.isSafeInteger(clock.get('version')) || clock.get('version') >= Number.MAX_SAFE_INTEGER)) {
        throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
      }
      const entries = marker.get('entries');
      if (!Array.isArray(entries)) throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
      const own = entries.find((entry) => entry?.requestId === intent.requestId
        && entry?.fenceId === intent.fenceId && entry?.requestVersion === intent.expectedVersion + 1);
      return { entries, own, clock, segment };
    });
    if (fence.get('state') === 'tombstone' && prepared.every(({ own }) => !own)) return;
    if (prepared.some(({ own }) => !own)) throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
    const displacedShiftCount = Number(fence.get('displacedShiftCount') ?? 0);
    if (!Number.isSafeInteger(displacedShiftCount) || displacedShiftCount < 0) throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
    const cancellationTaskRef = dbAdmin.collection('dp_responsibilityTasks').doc(`${intent.requestId}_cancellation_review`);
    const cancellationTask = displacedShiftCount > 0 ? await tx.get(cancellationTaskRef) : null;
    const responsibility = displacedShiftCount > 0 ? await resolveOperationalResponsibility({ transaction: tx,
      workspaceId: intent.workspaceId, activity: 'schedules', unitId: intent.unitId }) : null;
    const gapRecipients = responsibility && !responsibility.resolution.eligibleUserIds.length
      ? await resolveGapAlertRecipients(tx) : [];
    if (cancellationTask?.exists && (cancellationTask.get('requestId') !== intent.requestId
      || cancellationTask.get('kind') !== 'absence_cancellation_review')) throw fail('ABSENCE_OPERATIONAL_TASK_CHANGED');
    const publicationFence = await preparePublicationFenceAdvance(tx, intent.workspaceId, [intent.beneficiaryUid]);
    const now = new Date().toISOString();
    publicationFence.apply();
    prepared.forEach(({ entries, own, clock, segment }, index) => {
      tx.update(refs[index].marker, { entries: entries.filter((entry) => entry !== own), updatedAt: now });
      tx.set(refs[index].clock, { workspaceId: intent.workspaceId, beneficiaryUid: intent.beneficiaryUid,
        date: segment.date, epoch: readiness.get('epoch'),
        version: (clock.exists ? clock.get('version') as number : 0) + 1, updatedAt: now });
    });
    if (displacedShiftCount > 0 && responsibility) {
      const assignedUserIds = responsibility.resolution.eligibleUserIds;
      const taskVersion = cancellationTask?.exists ? Number(cancellationTask.get('version')) + 1 : 1;
      const payload = { id: cancellationTaskRef.id, workspaceId: intent.workspaceId, activity: 'schedules',
        kind: 'absence_cancellation_review', scope: responsibility.scope,
        scopeKey: responsibilityScopeKey(responsibility.scope), unitId: intent.unitId,
        requestId: intent.requestId, beneficiaryUid: intent.beneficiaryUid,
        startDate: intent.segments[0].date, endDate: intent.segments.at(-1)!.date,
        displacedShiftCount, status: assignedUserIds.length ? 'pending' : 'unassigned',
        assignedUserIds, assignedLevel: responsibility.resolution.effectiveLevel,
        coverageVersion: responsibility.resolution.version, version: taskVersion,
        createdAt: cancellationTask?.exists ? cancellationTask.get('createdAt') : now, updatedAt: now };
      if (cancellationTask?.exists) tx.set(cancellationTaskRef, payload, { merge: false });
      else tx.create(cancellationTaskRef, payload);
      createResponsibilityTaskNotifications(tx, { taskId: cancellationTaskRef.id, taskVersion,
        workspaceId: intent.workspaceId, recipients: assignedUserIds.length ? assignedUserIds : gapRecipients,
        unassigned: !assignedUserIds.length });
      tx.create(dbAdmin.collection('dp_responsibilityTaskAudit').doc(`${cancellationTaskRef.id}_${taskVersion}`), {
        workspaceId: intent.workspaceId, taskId: cancellationTaskRef.id, version: taskVersion,
        action: 'created_from_cancelled_absence', actorUid: intent.actorUid, at: now,
        displacedShiftCount,
      });
    }
    tx.update(fenceRef, { state: 'tombstone', cancellationTaskId: displacedShiftCount > 0 ? cancellationTaskRef.id : null,
      updatedAt: now });
    tx.update(availabilityRef, { state: 'tombstone', cancellationTaskId: displacedShiftCount > 0 ? cancellationTaskRef.id : null,
      updatedAt: now });
  });
}

function canAbort(actor: ServerUserContext, value: AbsenceRequestRecord) {
  return actor.workspace_id === value.workspaceId
    && actor.decoded.uid !== value.beneficiaryUid && actor.decoded.uid !== value.requesterUid
    && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })
    && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true
      && (value.assignedReviewerIds.includes(actor.decoded.uid) || value.custodianDpUid === actor.decoded.uid));
}

/** Wins RH CAS over final approval before any Coala tombstone is written. */
export async function requestOperationalAbort(intent: OperationalIntent, actor?: ServerUserContext) {
  const intentRef = operationalIntentRef(intent.requestId, intent.expectedVersion);
  await hrDbAdmin.runTransaction(async (tx) => {
    const [request, operation] = await Promise.all([tx.get(requests.doc(intent.requestId)), tx.get(intentRef)]);
    if (!operation.exists || operation.get('fenceId') !== intent.fenceId) throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    if (actor && (!request.exists || !canAbort(actor, request.data() as AbsenceRequestRecord))) {
      throw fail('ABSENCE_OPERATIONAL_ABORT_FORBIDDEN');
    }
    if (operation.get('status') === 'aborted' || operation.get('status') === 'abort_requested') return;
    if (!request.exists || request.get('version') !== intent.expectedVersion
      || request.get('operationalPending.operationId') !== intent.operationId
      || !['begun', 'prepared'].includes(String(operation.get('status')))) {
      throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    }
    tx.update(intentRef, { status: 'abort_requested', abortRequestedAt: new Date().toISOString() });
  });
}

/** Explicit abort: RH CAS first, Coala tombstone second, RH unlock last. */
export async function abortOperationalIntent(intent: OperationalIntent, actor?: ServerUserContext) {
  await requestOperationalAbort(intent, actor);
  await dbAdmin.runTransaction(async (tx) => {
    const readiness = await tx.get(operationalReadinessRef(intent.workspaceId));
    if (!operationalReadinessValid(readiness, intent.workspaceId)) throw fail('ABSENCE_OPERATIONAL_NOT_READY');
    const epoch = readiness.get('epoch') as string;
    const fenceRef = coalaFenceRef(intent.requestId);
    const availabilityRef = coalaAvailabilityRef(intent.requestId);
    const [fence, availability] = await Promise.all([tx.get(fenceRef), tx.get(availabilityRef)]);
    if (fence.exists !== availability.exists || availability.exists
      && (availability.get('fenceId') !== intent.fenceId
        || availability.get('requestVersion') !== intent.expectedVersion + 1
        || availability.get('epoch') !== epoch
        || availability.get('state') !== fence.get('state'))) {
      throw fail('ABSENCE_OPERATIONAL_AVAILABILITY_CHANGED');
    }
    if (fence.exists && (fence.get('fenceId') !== intent.fenceId
      || fence.get('requestVersion') !== intent.expectedVersion + 1
      || fence.get('epoch') !== epoch || fence.get('state') === 'active')) {
      throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
    }
    const refs = intent.segments.map((segment) => operationalDayRefs(intent.workspaceId, intent.beneficiaryUid, segment.date));
    const snapshots = await Promise.all(refs.map(({ marker, clock }) =>
      Promise.all([tx.get(marker), tx.get(clock)])));
    const publicationFence = await preparePublicationFenceAdvance(tx, intent.workspaceId, [intent.beneficiaryUid]);
    publicationFence.apply();
    snapshots.forEach(([marker, clock], index) => {
      const entries = marker.exists ? marker.get('entries') : [];
      if (!Array.isArray(entries) || entries.length > 20
        || marker.exists && marker.get('epoch') !== epoch
        || clock.exists && (clock.get('epoch') !== epoch || !Number.isSafeInteger(clock.get('version'))
          || clock.get('version') >= Number.MAX_SAFE_INTEGER)) throw fail('ABSENCE_OPERATIONAL_MARKER_INVALID');
      const own = entries.find((entry) => entry?.requestId === intent.requestId
        && entry?.fenceId === intent.fenceId && entry?.requestVersion === intent.expectedVersion + 1);
      if (own && (own.fenceId !== intent.fenceId || own.requestVersion !== intent.expectedVersion + 1
        || own.state === 'active')) throw fail('ABSENCE_OPERATIONAL_FENCE_CHANGED');
      if (!own) return;
      const at = new Date().toISOString();
      tx.update(refs[index].marker, { entries: entries.filter((entry) => entry !== own), updatedAt: at });
      tx.set(refs[index].clock, { workspaceId: intent.workspaceId, beneficiaryUid: intent.beneficiaryUid,
        date: intent.segments[index].date, epoch,
        version: (clock.exists ? clock.get('version') as number : 0) + 1, updatedAt: at });
    });
    tx.set(fenceRef, { requestId: intent.requestId, workspaceId: intent.workspaceId,
      beneficiaryUid: intent.beneficiaryUid, requestVersion: intent.expectedVersion + 1,
      fenceId: intent.fenceId, epoch, state: 'tombstone', updatedAt: new Date().toISOString() });
    tx.set(availabilityRef, availabilityProjection(intent, epoch, 'tombstone'));
  });
  await hrDbAdmin.runTransaction(async (tx) => {
    const ref = operationalIntentRef(intent.requestId, intent.expectedVersion);
    const [request, operation] = await Promise.all([tx.get(requests.doc(intent.requestId)), tx.get(ref)]);
    if (!operation.exists || operation.get('fenceId') !== intent.fenceId) throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    if (operation.get('status') === 'aborted') return;
    if (!request.exists) throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    const pending = request.get('operationalPending');
    if (request.get('workspaceId') !== intent.workspaceId
      || request.get('version') !== intent.expectedVersion || !pending
      || pending.operationId !== intent.operationId || pending.actionHash !== intent.actionHash
      || operation.get('status') !== 'abort_requested') {
      throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
    }
    if (actor && !canAbort(actor, request.data() as AbsenceRequestRecord)) throw fail('ABSENCE_OPERATIONAL_ABORT_FORBIDDEN');
    const at = new Date().toISOString();
    const current = request.data() as AbsenceRequestRecord;
    const executorUid = actor?.decoded.uid ?? intent.actorUid;
    tx.update(ref, { status: 'aborted', abortedAt: at });
    tx.update(requests.doc(intent.requestId), { operationalPending: null,
      version: intent.expectedVersion + 1, updatedAt: at,
      history: [...current.history, { action: 'operational_abort', actorUid: executorUid,
        at, version: intent.expectedVersion + 1 }] });
    tx.create(operationalAudit.doc(`${intent.requestId}_${intent.expectedVersion + 1}_abort`), {
      requestId: intent.requestId, workspaceId: intent.workspaceId,
      actorUid: executorUid, intentActorUid: intent.actorUid,
      action: 'abort', at: new Date().toISOString(), ttl: new Date(Date.now() + 365 * 86_400_000) });
  });
}

/** Ack is RH-only and follows a confirmed Coala commit; cross-database atomicity is not implied. */
export async function acknowledgeOperationalActivation(intent: OperationalIntent, actorUid = intent.actorUid) {
  const ref = operationalIntentRef(intent.requestId, intent.expectedVersion);
  const outbox = hrDbAdmin.collection('dp_absenceOutbox').doc(`${intent.requestId}_${intent.expectedVersion + 1}_operational_activation_pending`);
  const occurrence = hrDbAdmin.collection('dp_absenceOccurrences').doc(intent.requestId);
  await hrDbAdmin.runTransaction(async (tx) => {
    const [request, operation, event, occurrenceDoc] = await Promise.all([
      tx.get(requests.doc(intent.requestId)), tx.get(ref), tx.get(outbox), tx.get(occurrence),
    ]);
    if (!request.exists || request.get('status') !== 'approved' || request.get('version') !== intent.expectedVersion + 1
      || !operation.exists || operation.get('fenceId') !== intent.fenceId
      || !event.exists || !occurrenceDoc.exists
      || occurrenceDoc.get('requestVersion') !== intent.expectedVersion + 1) {
      throw fail('ABSENCE_OPERATIONAL_ACK_CHANGED');
    }
    if (operation.get('status') === 'active' && event.get('status') === 'done') return;
    if (operation.get('status') !== 'committed') throw fail('ABSENCE_OPERATIONAL_ACK_CHANGED');
    const at = new Date().toISOString();
    tx.update(ref, { status: 'active', activatedAt: at });
    tx.update(requests.doc(intent.requestId), { 'operationalFence.state': 'active' });
    tx.update(outbox, { status: 'done', completedAt: at });
    tx.update(occurrence, { projectionStatus: 'active', operationallyAppliedAt: at,
      operationalFenceId: intent.fenceId });
    tx.create(operationalAudit.doc(`${intent.requestId}_${intent.expectedVersion + 1}_activate`), {
      requestId: intent.requestId, workspaceId: intent.workspaceId, actorUid,
      intentActorUid: intent.actorUid,
      action: 'activate', at, ttl: new Date(Date.now() + 365 * 86_400_000) });
  });
}

export async function acknowledgeOperationalReversal(intent: OperationalIntent, cancellationVersion: number,
  actorUid = intent.actorUid) {
  const ref = operationalIntentRef(intent.requestId, intent.expectedVersion);
  const outbox = hrDbAdmin.collection('dp_absenceOutbox').doc(`${intent.requestId}_${cancellationVersion}_operational_reversal_pending`);
  const occurrence = hrDbAdmin.collection('dp_absenceOccurrences').doc(intent.requestId);
  await hrDbAdmin.runTransaction(async (tx) => {
    const [request, operation, event, occurrenceDoc] = await Promise.all([
      tx.get(requests.doc(intent.requestId)), tx.get(ref), tx.get(outbox), tx.get(occurrence),
    ]);
    if (!request.exists || request.get('status') !== 'cancelled' || request.get('version') !== cancellationVersion
      || !operation.exists || operation.get('fenceId') !== intent.fenceId || !event.exists
      || !occurrenceDoc.exists || occurrenceDoc.get('requestVersion') !== intent.expectedVersion + 1) {
      throw fail('ABSENCE_OPERATIONAL_REVERSAL_ACK_CHANGED');
    }
    if (operation.get('status') === 'reversed' && event.get('status') === 'done') return;
    const at = new Date().toISOString();
    tx.update(ref, { status: 'reversed', reversedAt: at });
    tx.update(requests.doc(intent.requestId), { 'operationalFence.state': 'reversed' });
    tx.update(outbox, { status: 'done', completedAt: at });
    tx.update(occurrence, { projectionStatus: 'reversed', operationallyReversedAt: at });
    tx.create(operationalAudit.doc(`${intent.requestId}_${cancellationVersion}_reverse`), {
      requestId: intent.requestId, workspaceId: intent.workspaceId, actorUid,
      intentActorUid: intent.actorUid,
      action: 'reverse', at, ttl: new Date(Date.now() + 365 * 86_400_000) });
  });
}

export async function reconcileOperationalAbsence(actor: ServerUserContext, requestId: string, expectedVersion: number,
  action: 'abort_preparation' | 'activate' | 'reverse') {
  if (!operationalGuardRequested()) throw fail('ABSENCE_OPERATIONAL_GUARD_OFF');
  const source = await requests.doc(requestId).get();
  if (!source.exists || source.get('version') !== expectedVersion) throw fail('ABSENCE_OPERATIONAL_REQUEST_CHANGED');
  const request = source.data() as AbsenceRequestRecord;
  if (request.workspaceId !== actor.workspace_id
    || !canAccessUnit(actor.userDoc, request.unitId, { isDefaultAdmin: actor.isDefaultAdmin })
    || !actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
    throw fail('ABSENCE_OPERATIONAL_RECONCILE_FORBIDDEN');
  }
  const intentVersion = action === 'abort_preparation' ? request.operationalPending?.expectedVersion
    : request.operationalFence ? request.operationalFence.requestVersion - 1 : undefined;
  if (!Number.isSafeInteger(intentVersion)) throw fail('ABSENCE_OPERATIONAL_INTENT_MISSING');
  const operation = await operationalIntentRef(requestId, intentVersion!).get();
  if (!operation.exists) throw fail('ABSENCE_OPERATIONAL_INTENT_MISSING');
  const intent = operation.data() as OperationalIntent;
  if (intent.workspaceId !== request.workspaceId || intent.beneficiaryUid !== request.beneficiaryUid
    || intent.unitId !== request.unitId || intent.expectedVersion !== intentVersion) {
    throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED');
  }
  if (action === 'abort_preparation') {
    if (request.status === 'approved' || !request.operationalPending
      || request.operationalPending.operationId !== intent.operationId || !canAbort(actor, request)) {
      throw fail('ABSENCE_OPERATIONAL_ABORT_UNAVAILABLE');
    }
    await abortOperationalIntent(intent, actor);
    return { mode: 'operational' as const, state: 'aborted' as const, operationallyApplied: false };
  }
  if (action === 'activate') {
    if (request.status !== 'approved' || request.operationalFence?.fenceId !== intent.fenceId) {
      throw fail('ABSENCE_OPERATIONAL_ACTIVATION_UNAVAILABLE');
    }
    await activateOperationalAbsence(intent);
    await acknowledgeOperationalActivation(intent, actor.decoded.uid);
    return { mode: 'operational' as const, state: 'active' as const, operationallyApplied: true };
  }
  if (request.status !== 'cancelled' || request.operationalFence?.fenceId !== intent.fenceId) {
    throw fail('ABSENCE_OPERATIONAL_REVERSAL_UNAVAILABLE');
  }
  await reverseOperationalAbsence(intent);
  await acknowledgeOperationalReversal(intent, expectedVersion, actor.decoded.uid);
  return { mode: 'operational' as const, state: 'reversed' as const, operationallyApplied: false };
}
