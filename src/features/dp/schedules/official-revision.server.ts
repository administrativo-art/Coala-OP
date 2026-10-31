import 'server-only';

import { createHash } from 'node:crypto';
import type { DocumentData, DocumentSnapshot, Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';

/**
 * Inactive revision read contract. The pointer is the only commit point; revision entries are immutable.
 * Operational per-person overlays belong to the pointer generation and may be updated in small transactions.
 * No route uses this reader until all operational writers and consumers follow this contract.
 */
export type OfficialShift = { id: string; scheduleId: string } & Record<string, unknown>;
export type OfficialScheduleRead = { scheduleId: string; revisionId: string | null; shifts: OfficialShift[] };
const MAX_FULL_SHIFTS = 2_000;
const MAX_OPERATIONAL_EDITS = 2_000;
const MAX_PERSON_SHIFTS = 62;
const MAX_CANDIDATE_SCHEDULES = 100;

function failure(code: string, message: string): never {
  throw new AppError({ code, kind: 'DATA_INTEGRITY', safeMessage: message });
}
function pathId(value: string) {
  if (!value || value.includes('/')) failure('DP_OFFICIAL_PATH_INVALID', 'Identificador de escala inválido.');
  return value;
}
function data(document: QueryDocumentSnapshot<DocumentData>) {
  return { id: document.id, ...document.data() } as Record<string, unknown> & { id: string };
}
function materialize(scheduleId: string, value: Record<string, unknown> & { id: string }): OfficialShift {
  return { ...value, scheduleId };
}
function activeRevision(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value || value.includes('/')) failure('DP_OFFICIAL_POINTER_INVALID', 'A revisão oficial está inconsistente.');
  return value;
}
function effective(map: Map<string, OfficialShift>, id: string, value: unknown, scheduleId: string) {
  if (value === null) { map.delete(id); return; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) failure('DP_OFFICIAL_OVERLAY_INVALID', 'Uma alteração operacional está inconsistente.');
  map.set(id, materialize(scheduleId, { id, ...(value as Record<string, unknown>) }));
}
function dateRange(schedule: Record<string, unknown>) {
  const year = Number(schedule.year); const month = Number(schedule.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) failure('DP_OFFICIAL_PERIOD_INVALID', 'A competência da escala está inconsistente.');
  return { from: `${year}-${String(month).padStart(2, '0')}-01`,
    through: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
function between(date: unknown, from: string, through: string) {
  return typeof date === 'string' && date >= from && date <= through;
}
function personIndexRef(db: Firestore, userId: string, competence: string) {
  const hash = createHash('sha256').update(`${userId}:${competence}`).digest('hex');
  return db.collection('dp_personScheduleIndex').doc(hash);
}

/** Caller must authorize schedule/unit access before returning these rows to a client. */
export async function readOfficialScheduleShifts(params: {
  scheduleId: string; db?: Firestore; userId?: string; from?: string; through?: string;
}): Promise<OfficialScheduleRead> {
  const db = params.db ?? dbAdmin;
  const scheduleId = pathId(params.scheduleId);
  const scheduleRef = db.collection('dp_schedules').doc(scheduleId);
  const schedule = await scheduleRef.get();
  if (!schedule.exists) failure('DP_SCHEDULE_NOT_FOUND', 'Escala não encontrada.');
  const scheduleData = schedule.data() ?? {};
  const pointer = activeRevision(scheduleData.activeRevisionId);
  if (!hasPublishedScheduleVersion(scheduleData) && !pointer) return { scheduleId, revisionId: null, shifts: [] };
  const period = dateRange(scheduleData);
  const from = params.from ?? period.from; const through = params.through ?? period.through;
  if (from < period.from || through > period.through || from > through) failure('DP_OFFICIAL_RANGE_INVALID', 'Período de leitura inválido.');
  if (!pointer) {
    // Legacy schedules are already published. Their original collection remains authoritative until prepared migration.
    let query = scheduleRef.collection('shifts').where('date', '>=', from).where('date', '<=', through).orderBy('date');
    if (params.userId) query = query.where('userId', '==', params.userId);
    const legacy = await query.limit(params.userId ? MAX_PERSON_SHIFTS + 1 : MAX_FULL_SHIFTS + 1).get();
    if (legacy.size > (params.userId ? MAX_PERSON_SHIFTS : MAX_FULL_SHIFTS)) failure('DP_OFFICIAL_READ_LIMIT', 'A escala excede o limite de leitura seguro.');
    return { scheduleId, revisionId: null, shifts: legacy.docs.map((item) => materialize(scheduleId, data(item))) };
  }
  const revisionRef = scheduleRef.collection('revisions').doc(pointer);
  const manifest = await revisionRef.get();
  if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('scheduleId') !== scheduleId) {
    failure('DP_OFFICIAL_REVISION_INCOMPLETE', 'A revisão oficial não está disponível.');
  }
  const rows = new Map<string, OfficialShift>();
  if (params.userId) {
    const personRef = revisionRef.collection('people').doc(pathId(params.userId));
    const person = await personRef.get();
    const entries = person.exists ? person.get('shifts') : [];
    if (!Array.isArray(entries) || entries.length > MAX_PERSON_SHIFTS) failure('DP_OFFICIAL_PERSON_INVALID', 'A linha de escala da pessoa está inconsistente.');
    for (const value of entries) {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string') failure('DP_OFFICIAL_PERSON_INVALID', 'A linha de escala da pessoa está inconsistente.');
      if (between(value.date, from, through)) rows.set(value.id, materialize(scheduleId, value));
    }
    const personOverlay = await scheduleRef.collection('operationalOverlays').doc(pointer)
      .collection('people').doc(params.userId).get();
    const edits = personOverlay.exists ? personOverlay.get('edits') : {};
    if (!edits || typeof edits !== 'object' || Array.isArray(edits) || Object.keys(edits).length > MAX_PERSON_SHIFTS) {
      failure('DP_OFFICIAL_OVERLAY_INVALID', 'Uma alteração operacional está inconsistente.');
    }
    for (const [id, value] of Object.entries(edits)) effective(rows, id, value, scheduleId);
  } else {
    const [base, overlay] = await Promise.all([
      revisionRef.collection('entries').limit(MAX_FULL_SHIFTS + 1).get(),
      scheduleRef.collection('operationalOverlays').doc(pointer).collection('entries').limit(MAX_OPERATIONAL_EDITS + 1).get(),
    ]);
    if (base.size > MAX_FULL_SHIFTS || overlay.size > MAX_OPERATIONAL_EDITS) failure('DP_OFFICIAL_READ_LIMIT', 'A escala excede o limite de leitura seguro.');
    for (const item of base.docs) rows.set(item.id, materialize(scheduleId, data(item)));
    for (const item of overlay.docs) effective(rows, item.id, item.get('value'), scheduleId);
  }
  const shifts = [...rows.values()].filter((item) => between(item.date, from, through)
    && (!params.userId || item.userId === params.userId)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (shifts.length > (params.userId ? MAX_PERSON_SHIFTS : MAX_FULL_SHIFTS)) failure('DP_OFFICIAL_READ_LIMIT', 'A escala excede o limite de leitura seguro.');
  const confirmed = await scheduleRef.get();
  if (confirmed.get('activeRevisionId') !== pointer
    || confirmed.get('operationalVersion') !== schedule.get('operationalVersion')
    || confirmed.get('publicationVersion') !== schedule.get('publicationVersion')) {
    throw new AppError({ code: 'DP_OFFICIAL_READ_CHANGED', kind: 'CONFLICT',
      safeMessage: 'A escala oficial mudou durante a leitura. Tente novamente.' });
  }
  return { scheduleId, revisionId: pointer, shifts };
}

/** Transactional official read for goal decisions that also write in the same transaction. */
export async function readOfficialScheduleShiftsInTransaction(tx: Transaction, schedule: DocumentSnapshot,
  options: { userId?: string; from?: string; through?: string } = {}): Promise<OfficialShift[]> {
  if (!schedule.exists) failure('DP_SCHEDULE_NOT_FOUND', 'Escala não encontrada.');
  const scheduleData = schedule.data() ?? {};
  const pointer = activeRevision(scheduleData.activeRevisionId);
  if (!hasPublishedScheduleVersion(scheduleData) && !pointer) return [];
  const period = dateRange(scheduleData);
  const from = options.from ?? period.from;
  const through = options.through ?? period.through;
  if (from < period.from || through > period.through || from > through) failure('DP_OFFICIAL_RANGE_INVALID', 'Período inválido.');
  if (!pointer) {
    let query = schedule.ref.collection('shifts').where('date', '>=', from).where('date', '<=', through).orderBy('date');
    if (options.userId) query = query.where('userId', '==', options.userId);
    const result = await tx.get(query.limit(options.userId ? MAX_PERSON_SHIFTS + 1 : MAX_FULL_SHIFTS + 1));
    if (result.size > (options.userId ? MAX_PERSON_SHIFTS : MAX_FULL_SHIFTS)) failure('DP_OFFICIAL_READ_LIMIT', 'A escala excede o limite seguro.');
    return result.docs.map((doc) => materialize(schedule.id, data(doc)));
  }
  const revisionRef = schedule.ref.collection('revisions').doc(pointer);
  const manifest = await tx.get(revisionRef);
  if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('scheduleId') !== schedule.id) {
    failure('DP_OFFICIAL_REVISION_INCOMPLETE', 'A revisão oficial não está disponível.');
  }
  const rows = new Map<string, OfficialShift>();
  if (options.userId) {
    const [person, overlay] = await Promise.all([
      tx.get(revisionRef.collection('people').doc(pathId(options.userId))),
      tx.get(schedule.ref.collection('operationalOverlays').doc(pointer).collection('people').doc(options.userId)),
    ]);
    const base = person.exists ? person.get('shifts') : [];
    const edits = overlay.exists ? overlay.get('edits') : {};
    if (!Array.isArray(base) || base.length > MAX_PERSON_SHIFTS || !edits || typeof edits !== 'object'
      || Array.isArray(edits) || Object.keys(edits).length > MAX_PERSON_SHIFTS) failure('DP_OFFICIAL_PERSON_INVALID', 'A linha da pessoa está inconsistente.');
    base.forEach((value) => { if (!value || typeof value.id !== 'string') failure('DP_OFFICIAL_PERSON_INVALID', 'Turno da pessoa inválido.');
      rows.set(value.id, materialize(schedule.id, value)); });
    Object.entries(edits).forEach(([id, value]) => effective(rows, id, value, schedule.id));
  } else {
    const [base, overlay] = await Promise.all([
      tx.get(revisionRef.collection('entries').limit(MAX_FULL_SHIFTS + 1)),
      tx.get(schedule.ref.collection('operationalOverlays').doc(pointer).collection('entries').limit(MAX_OPERATIONAL_EDITS + 1)),
    ]);
    if (base.size > MAX_FULL_SHIFTS || overlay.size > MAX_OPERATIONAL_EDITS) failure('DP_OFFICIAL_READ_LIMIT', 'A escala excede o limite seguro.');
    base.docs.forEach((doc) => rows.set(doc.id, materialize(schedule.id, data(doc))));
    overlay.docs.forEach((doc) => effective(rows, doc.id, doc.get('value'), schedule.id));
  }
  const result = [...rows.values()].filter((shift) => between(shift.date, from, through)
    && (!options.userId || shift.userId === options.userId));
  if (result.length > (options.userId ? MAX_PERSON_SHIFTS : MAX_FULL_SHIFTS)) failure('DP_OFFICIAL_READ_LIMIT', 'A escala excede o limite seguro.');
  return result;
}

/** Candidate index is prepared before pointer switch; stale candidates are harmless after pointer verification. */
export async function readOfficialPersonMonth(params: { userId: string; competence: string; from?: string; through?: string; db?: Firestore }) {
  const db = params.db ?? dbAdmin;
  const userId = pathId(params.userId);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.competence)) failure('DP_OFFICIAL_PERIOD_INVALID', 'Competência inválida.');
  const index = await personIndexRef(db, userId, params.competence).get();
  if (!index.exists) return { shifts: [] as OfficialShift[], indexed: false };
  if (index.get('userId') !== userId || index.get('competence') !== params.competence) failure('DP_OFFICIAL_INDEX_INVALID', 'O índice de escalas está inconsistente.');
  const scheduleIds = index.get('scheduleIds');
  if (!Array.isArray(scheduleIds) || scheduleIds.length > MAX_CANDIDATE_SCHEDULES
    || scheduleIds.some((id) => typeof id !== 'string' || !id || id.includes('/'))) failure('DP_OFFICIAL_INDEX_INVALID', 'O índice de escalas está inconsistente.');
  const results = await Promise.all(scheduleIds.map((scheduleId: string) => readOfficialScheduleShifts({ scheduleId, userId, from: params.from, through: params.through, db })));
  return { indexed: true, shifts: results.flatMap((result) => result.shifts) };
}
