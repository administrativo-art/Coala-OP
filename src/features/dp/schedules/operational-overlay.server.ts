import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { dbAdmin } from '@/lib/firebase-admin';
import { scheduleShiftFingerprint } from '@/lib/dp-schedule-publication';
import { AppError } from '@/lib/observability/app-error';
import { preparePublicationFenceAdvance } from './publication-fence.server';

type Shift = Record<string, unknown>;
export type OperationalShiftChange = { shiftId: string; previous: Shift | null; next: Shift | null };
const MAX_CHANGES_PER_TRANSACTION = 20;
const MAX_PERSON_EDITS = 62;
const MAX_CANDIDATE_SCHEDULES = 100;

function invalid(code: string, safeMessage: string): never {
  throw new AppError({ code, kind: 'CONFLICT', safeMessage });
}
function id(value: string) {
  if (!value || value.includes('/')) invalid('DP_OPERATIONAL_ID_INVALID', 'Identificador de turno inválido.');
  return value;
}
function personKey(value: Shift | null) {
  const userId = value?.userId;
  const date = value?.date;
  if (!value) return null;
  if (typeof userId !== 'string' || !userId || typeof date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) {
    invalid('DP_OPERATIONAL_SHIFT_INVALID', 'Turno operacional inconsistente.');
  }
  return { userId, competence: date.slice(0, 7) };
}
function indexRef(userId: string, competence: string) {
  return dbAdmin.collection('dp_personScheduleIndex').doc(createHash('sha256').update(`${userId}:${competence}`).digest('hex'));
}

/**
 * Call after domain reads and before any transaction writes. The schedule snapshot must come from
 * the same transaction. Legacy writers continue using `shifts`; this helper only accepts a pointer.
 * Each overlay write and the schedule's operationalVersion commit in one Firestore transaction.
 */
export async function prepareActiveRevisionOperationalChanges(params: {
  tx: Transaction; schedule: DocumentSnapshot; changes: OperationalShiftChange[];
  actorId: string; reason: string; workspaceId: string;
}) {
  const { tx, schedule, changes, actorId, reason, workspaceId } = params;
  const scheduleRef = schedule.ref;
  if (!schedule.exists || scheduleRef.parent.id !== 'dp_schedules') invalid('DP_OPERATIONAL_SCHEDULE_INVALID', 'Escala oficial inválida.');
  const revisionId = schedule.get('activeRevisionId');
  if (typeof revisionId !== 'string' || !revisionId || revisionId.includes('/')) invalid('DP_OPERATIONAL_POINTER_REQUIRED', 'A escala não possui revisão ativa.');
  if (!changes.length || changes.length > MAX_CHANGES_PER_TRANSACTION || new Set(changes.map((change) => change.shiftId)).size !== changes.length) {
    invalid('DP_OPERATIONAL_CHANGE_LIMIT', 'Há turnos demais ou repetidos nesta operação.');
  }
  const revisionRef = scheduleRef.collection('revisions').doc(revisionId);
  const overlayRef = scheduleRef.collection('operationalOverlays').doc(revisionId);
  const entryRefs = changes.map((change) => overlayRef.collection('entries').doc(id(change.shiftId)));
  const baseRefs = changes.map((change) => revisionRef.collection('entries').doc(change.shiftId));
  const people = new Map<string, { userId: string; competence: string }>();
  changes.forEach((change) => [personKey(change.previous), personKey(change.next)].forEach((person) => {
    if (person) people.set(person.userId, person);
  }));
  const peopleRefs = [...people.values()].map((person) => overlayRef.collection('people').doc(id(person.userId)));
  const newPeople = [...new Map(changes.flatMap((change) => {
    const person = personKey(change.next);
    return person ? [[`${person.userId}:${person.competence}`, person] as const] : [];
  })).values()];
  const indexRefs = newPeople.map((person) => indexRef(person.userId, person.competence));
  const [manifest, bases, overlays, personRows, indexes] = await Promise.all([
    tx.get(revisionRef), tx.getAll(...baseRefs), tx.getAll(...entryRefs),
    peopleRefs.length ? tx.getAll(...peopleRefs) : [],
    indexRefs.length ? tx.getAll(...indexRefs) : [],
  ]);
  if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('scheduleId') !== schedule.id) {
    invalid('DP_OPERATIONAL_REVISION_INCOMPLETE', 'A revisão oficial não está pronta.');
  }
  const personEdits = new Map<string, Record<string, Shift | null>>();
  [...people.values()].forEach((person, index) => {
    const raw = personRows[index].exists ? personRows[index].get('edits') : {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > MAX_PERSON_EDITS) {
      invalid('DP_OPERATIONAL_PERSON_OVERLAY_INVALID', 'Alterações da pessoa estão inconsistentes.');
    }
    personEdits.set(person.userId, { ...raw });
  });
  changes.forEach((change, index) => {
    const base = bases[index].exists ? bases[index].data() ?? {} : null;
    const current = overlays[index].exists ? overlays[index].get('value') as Shift | null : base;
    if (scheduleShiftFingerprint(current) !== scheduleShiftFingerprint(change.previous)) {
      invalid('DP_OPERATIONAL_SHIFT_CHANGED', 'O turno mudou durante a operação. Atualize a escala.');
    }
    const oldPerson = personKey(change.previous);
    const nextPerson = personKey(change.next);
    if (oldPerson) personEdits.get(oldPerson.userId)![change.shiftId] = null;
    if (nextPerson) personEdits.get(nextPerson.userId)![change.shiftId] = change.next;
  });
  for (const edits of personEdits.values()) {
    if (Object.keys(edits).length > MAX_PERSON_EDITS) invalid('DP_OPERATIONAL_PERSON_LIMIT', 'Há alterações operacionais demais para a pessoa nesta competência.');
  }
  newPeople.forEach((person, index) => {
    const current = indexes[index].exists ? indexes[index].get('scheduleIds') : [];
    if (!Array.isArray(current) || current.length > MAX_CANDIDATE_SCHEDULES) invalid('DP_OPERATIONAL_INDEX_INVALID', 'O índice de escalas da pessoa está inconsistente.');
    if (!current.includes(schedule.id) && current.length >= MAX_CANDIDATE_SCHEDULES) invalid('DP_OPERATIONAL_INDEX_LIMIT', 'A pessoa possui escalas candidatas demais nesta competência.');
  });
  if (schedule.get('workspaceId') && schedule.get('workspaceId') !== workspaceId) invalid('DP_OPERATIONAL_WORKSPACE_INVALID', 'A escala pertence a outro ambiente.');
  const publicationFence = await preparePublicationFenceAdvance(tx, workspaceId,
    changes.flatMap((change) => [change.previous?.userId, change.next?.userId]
      .filter((userId): userId is string => typeof userId === 'string' && Boolean(userId))));
  const now = Timestamp.now();
  const delta = changes.reduce((count, change) => count + Number(Boolean(change.next)) - Number(Boolean(change.previous)), 0);
  return { apply() {
    publicationFence.apply();
    for (const [userId, edits] of personEdits) tx.set(overlayRef.collection('people').doc(userId), { edits, updatedAt: now });
    newPeople.forEach((person, index) => tx.set(indexRefs[index], { userId: person.userId, competence: person.competence,
      scheduleIds: FieldValue.arrayUnion(schedule.id), updatedAt: now }, { merge: true }));
    changes.forEach((change, index) => tx.set(entryRefs[index], { value: change.next,
      affectedUserIds: [...new Set([personKey(change.previous)?.userId, personKey(change.next)?.userId].filter(Boolean))],
      reason, actorId, updatedAt: now }));
    tx.update(scheduleRef, { operationalVersion: FieldValue.increment(1),
      shiftCount: FieldValue.increment(delta), goalEligibilityVersion: FieldValue.increment(1),
      journeyValidationVersion: FieldValue.increment(1) });
  } };
}

export async function applyActiveRevisionOperationalChanges(params: Parameters<typeof prepareActiveRevisionOperationalChanges>[0]) {
  (await prepareActiveRevisionOperationalChanges(params)).apply();
}

/** Reads one effective shift inside the caller's transaction. Null means deleted/missing. */
export async function readActiveRevisionShift(tx: Transaction, schedule: DocumentSnapshot, shiftId: string): Promise<Shift | null> {
  const revisionId = schedule.get('activeRevisionId');
  if (typeof revisionId !== 'string' || !revisionId) invalid('DP_OPERATIONAL_POINTER_REQUIRED', 'A escala não possui revisão ativa.');
  const revisionRef = schedule.ref.collection('revisions').doc(revisionId);
  const overlayRef = schedule.ref.collection('operationalOverlays').doc(revisionId).collection('entries').doc(id(shiftId));
  const [manifest, base, overlay] = await Promise.all([
    tx.get(revisionRef), tx.get(revisionRef.collection('entries').doc(shiftId)), tx.get(overlayRef),
  ]);
  if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('scheduleId') !== schedule.id) {
    invalid('DP_OPERATIONAL_REVISION_INCOMPLETE', 'A revisão oficial não está pronta.');
  }
  return overlay.exists ? overlay.get('value') as Shift | null : base.exists ? base.data() ?? {} : null;
}

/** Candidate index is a superset; each schedule pointer is checked in this transaction. */
export async function readActiveRevisionPersonMonth(tx: Transaction, userId: string, competence: string): Promise<Array<Shift & { id: string; scheduleId: string }>> {
  const index = await tx.get(indexRef(id(userId), competence));
  if (!index.exists) return [];
  if (index.get('userId') !== userId || index.get('competence') !== competence) invalid('DP_OPERATIONAL_INDEX_INVALID', 'O índice da pessoa está inconsistente.');
  const scheduleIds = index.get('scheduleIds');
  if (!Array.isArray(scheduleIds) || scheduleIds.length > MAX_CANDIDATE_SCHEDULES
    || scheduleIds.some((candidate) => typeof candidate !== 'string' || !candidate || candidate.includes('/'))) {
    invalid('DP_OPERATIONAL_INDEX_INVALID', 'O índice da pessoa está inconsistente.');
  }
  if (scheduleIds.length > 20) invalid('DP_OPERATIONAL_DAY_SCHEDULE_LIMIT', 'Há escalas candidatas demais para validar o dia.');
  const schedules = scheduleIds.length ? await tx.getAll(...scheduleIds.map((candidate) => dbAdmin.collection('dp_schedules').doc(candidate))) : [];
  const result: Array<Shift & { id: string; scheduleId: string }> = [];
  for (const schedule of schedules) {
    const revisionId = schedule.get('activeRevisionId');
    if (!schedule.exists || typeof revisionId !== 'string' || !revisionId) continue;
    const revisionRef = schedule.ref.collection('revisions').doc(revisionId);
    const [manifest, person, overlay] = await Promise.all([
      tx.get(revisionRef), tx.get(revisionRef.collection('people').doc(userId)),
      tx.get(schedule.ref.collection('operationalOverlays').doc(revisionId).collection('people').doc(userId)),
    ]);
    if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('scheduleId') !== schedule.id) {
      invalid('DP_OPERATIONAL_REVISION_INCOMPLETE', 'A revisão oficial não está pronta.');
    }
    const shifts = person.exists ? person.get('shifts') : [];
    const edits = overlay.exists ? overlay.get('edits') : {};
    if (!Array.isArray(shifts) || shifts.length > MAX_PERSON_EDITS || !edits || typeof edits !== 'object'
      || Array.isArray(edits) || Object.keys(edits).length > MAX_PERSON_EDITS) {
      invalid('DP_OPERATIONAL_PERSON_OVERLAY_INVALID', 'A escala da pessoa está inconsistente.');
    }
    const effective = new Map<string, Shift>();
    shifts.forEach((shift: Shift) => { if (typeof shift.id === 'string') effective.set(shift.id, shift); });
    Object.entries(edits as Record<string, Shift | null>).forEach(([shiftId, value]) => {
      if (value) effective.set(shiftId, value); else effective.delete(shiftId);
    });
    for (const [shiftId, shift] of effective) {
      if (shift.userId === userId && typeof shift.date === 'string' && shift.date.startsWith(`${competence}-`)) result.push({ ...shift, id: shiftId, scheduleId: schedule.id });
    }
  }
  if (result.length > 200) invalid('DP_OPERATIONAL_MONTH_SHIFT_LIMIT', 'Há turnos demais para validar a competência.');
  return result;
}

export async function readActiveRevisionPersonDay(tx: Transaction, userId: string, date: string) {
  return (await readActiveRevisionPersonMonth(tx, userId, date.slice(0, 7))).filter((shift) => shift.date === date);
}
