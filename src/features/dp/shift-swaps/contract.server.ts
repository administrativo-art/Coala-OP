import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';

import { guardOccupancyWrite, operationalGuardRequested, shiftOccupancySlices } from '@/features/dp/absences/operational/occupancy-guard.server';
import { todayInBelem } from '@/features/hr/requests/core';
import { readOfficialScheduleShifts } from '@/features/dp/schedules/official-revision.server';
import { prepareActiveRevisionOperationalChanges, readActiveRevisionPersonDay, readActiveRevisionShift } from '@/features/dp/schedules/operational-overlay.server';
import { preparePublicationFenceAdvance } from '@/features/dp/schedules/publication-fence.server';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';
import type { ServerUserContext } from '@/lib/auth-server';
import { resolveDPJourney } from '@/lib/dp-journey-resolution';
import { buildDPShiftReference } from '@/lib/dp-shift-reference';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { DPJourney, DPShiftDefinition } from '@/types';

import type { CreateShiftSwapInput, DecideShiftSwapInput } from './schemas';
import type {
  ShiftSwapEvent,
  ShiftSwapIdentityEvidence,
  ShiftSwapOption,
  ShiftSwapRequest,
  ShiftSwapShift,
  ShiftSwapStatus,
} from './types';

export const SHIFT_SWAP_REQUESTS = 'dp_shiftSwapRequests';
const REQUESTS = SHIFT_SWAP_REQUESTS;
const REFERENCE_HISTORY = 'dp_shiftReferenceHistory';
const MAX_OPTIONS = 200;
const MAX_OPTION_SCHEDULES = 20;
const MAX_OCCUPANCIES = 21;
const MAX_JOURNEYS = 100;
const AUDIT_TTL_MS = 20 * 366 * 24 * 60 * 60 * 1_000;

type ShiftDocument = Pick<DocumentSnapshot, 'id' | 'ref' | 'exists' | 'get' | 'data'>;
function logicalShift(ref: DocumentReference, value: Record<string, unknown> | null): ShiftDocument {
  return { id: ref.id, ref, exists: value !== null, data: () => value ?? undefined,
    get: (field: string) => field.split('.').reduce<unknown>((item, key) =>
      item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined, value) } as ShiftDocument;
}
async function transactionShift(tx: Transaction, schedule: DocumentSnapshot, ref: DocumentReference): Promise<ShiftDocument> {
  if (!schedule.get('activeRevisionId')) return tx.get(ref);
  return logicalShift(ref, await readActiveRevisionShift(tx, schedule, ref.id));
}

type Notification = { recipientUid: string; eventId: string; path: '/dashboard/collaborator/requests' };

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stableUuid(value: string) {
  const hex = digest(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'AUTHORIZATION' | 'DATA_INTEGRITY' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage, reportable: kind === 'DATA_INTEGRITY' });
}
function text(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function strings(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))]
    : [];
}
function iso(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return '';
}
function displayName(document: DocumentSnapshot, fallback: string) {
  return text(document.get('username'), 180) ?? text(document.get('name'), 180) ?? fallback;
}
function actorMayRequest(context: ServerUserContext) {
  return context.permissions.dashboard.collaborator === true || context.permissions.dashboard.view === true;
}
function assertActorMayRequest(context: ServerUserContext) {
  if (!actorMayRequest(context)) throw fail('SHIFT_SWAP_FORBIDDEN', 'Sem acesso às solicitações do colaborador.', 'AUTHORIZATION');
  if (context.userDoc.id !== context.decoded.uid) throw fail('SHIFT_SWAP_IDENTITY_MISMATCH', 'A identidade da sessão não corresponde ao cadastro.', 'AUTHORIZATION');
}
function shiftFingerprint(value: Record<string, unknown>) {
  return digest({
    userId: value.userId ?? null,
    unitId: value.unitId ?? null,
    date: value.date ?? null,
    startTime: value.startTime ?? null,
    endTime: value.endTime ?? null,
    type: value.type ?? null,
    shiftDefinitionId: value.shiftDefinitionId ?? null,
    referenceRevisionId: value.referenceRevisionId ?? null,
  });
}
function shiftKey(scheduleId: string, shiftId: string) { return `${scheduleId}/${shiftId}`; }
function millis(value: unknown) {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  return 0;
}
function plusDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function monthsBetween(start: string, end: string) {
  const result: Array<{ year: number; month: number }> = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = end.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= last) {
    result.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
function serializeEvent(raw: unknown): ShiftSwapEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const action = String(value.action ?? '');
  if (!['submitted', 'accepted', 'rejected', 'cancelled', 'marked_stale'].includes(action)) return null;
  const evidence = value.evidence && typeof value.evidence === 'object' ? value.evidence as Record<string, unknown> : {};
  return {
    action: action as ShiftSwapEvent['action'],
    at: iso(value.at),
    actorUid: String(value.actorUid ?? ''),
    actorName: String(value.actorName ?? 'Colaborador'),
    declaration: String(value.declaration ?? ''),
    evidence: {
      authenticatedUid: String(evidence.authenticatedUid ?? ''),
      authenticatedEmail: text(evidence.authenticatedEmail, 320),
      actorName: String(evidence.actorName ?? 'Colaborador'),
      authTime: text(evidence.authTime, 80),
      signInProvider: text(evidence.signInProvider, 80),
      ipAddress: text(evidence.ipAddress, 80),
      userAgent: text(evidence.userAgent, 500),
      operationId: String(evidence.operationId ?? ''),
    },
  };
}
function serializeShift(raw: unknown): ShiftSwapShift {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    scheduleId: String(value.scheduleId ?? ''), shiftId: String(value.shiftId ?? ''), unitId: String(value.unitId ?? ''),
    unitName: String(value.unitName ?? 'Unidade'), date: String(value.date ?? ''), startTime: String(value.startTime ?? ''),
    endTime: String(value.endTime ?? ''), shiftDefinitionId: text(value.shiftDefinitionId, 180), shiftName: text(value.shiftName, 180),
    occupantUid: String(value.occupantUid ?? ''), occupantName: String(value.occupantName ?? 'Colaborador'), fingerprint: String(value.fingerprint ?? ''),
  };
}
export function serializeShiftSwap(id: string, raw: Record<string, unknown>): ShiftSwapRequest {
  const status = String(raw.status ?? 'pending');
  return {
    id,
    workspaceId: String(raw.workspaceId ?? ''),
    status: (['pending', 'accepted', 'rejected', 'cancelled', 'stale'].includes(status) ? status : 'stale') as ShiftSwapStatus,
    version: Number(raw.version ?? 0),
    requesterUid: String(raw.requesterUid ?? ''), requesterName: String(raw.requesterName ?? 'Colaborador'),
    targetUid: String(raw.targetUid ?? ''), targetName: String(raw.targetName ?? 'Colaborador'),
    participantUids: strings(raw.participantUids), offeredShift: serializeShift(raw.offeredShift), requestedShift: serializeShift(raw.requestedShift),
    reason: text(raw.reason), events: Array.isArray(raw.events) ? raw.events.flatMap((entry) => serializeEvent(entry) ?? []) : [],
    createdAt: iso(raw.createdAt), updatedAt: iso(raw.updatedAt), decidedAt: raw.decidedAt ? iso(raw.decidedAt) : null,
  };
}

export function shiftSwapForViewer(request: ShiftSwapRequest, viewerUid: string): ShiftSwapRequest {
  const pending = request.status === 'pending';
  return { ...request, events: request.events.map((item) => ({ ...item, evidence: {
    ...item.evidence,
    authenticatedEmail: null,
    authTime: null,
    ipAddress: null,
    userAgent: null,
    operationId: '',
  } })), viewerActions: {
    accept: pending && request.targetUid === viewerUid,
    reject: pending && request.targetUid === viewerUid,
    cancel: pending && request.requesterUid === viewerUid,
  } };
}

function option(document: ShiftDocument, scheduleId: string, unitName: string, shiftName: string | null, occupantName: string): ShiftSwapOption {
  return {
    scheduleId, shiftId: document.id, unitId: String(document.get('unitId') ?? ''), unitName,
    date: String(document.get('date') ?? ''), startTime: String(document.get('startTime') ?? ''), endTime: String(document.get('endTime') ?? ''),
    shiftDefinitionId: text(document.get('shiftDefinitionId'), 180), shiftName,
    occupantUid: String(document.get('userId') ?? ''), occupantName,
  };
}

/** Opções do contrato central: somente turnos futuros que realmente podem formar um par na mesma unidade e data. */
export async function listShiftSwapOptions(context: ServerUserContext) {
  assertActorMayRequest(context);
  const today = todayInBelem();
  const end = plusDays(today, 62);
  const scheduleSnapshots = await Promise.all(monthsBetween(today, end).map(({ year, month }) => dbAdmin.collection('dp_schedules')
    .where('year', '==', year).where('month', '==', month).get()));
  const selected = new Map<string, QueryDocumentSnapshot>();
  for (const schedule of scheduleSnapshots.flatMap((snapshot) => snapshot.docs)
    .filter((item) => hasPublishedScheduleVersion(item.data())).sort((left, right) => (
    millis(right.get('createdAt')) - millis(left.get('createdAt'))
  ))) {
    const unitId = String(schedule.get('unitId') ?? '');
    if (unitId && !selected.has(`${schedule.get('year')}-${schedule.get('month')}-${unitId}`)) selected.set(`${schedule.get('year')}-${schedule.get('month')}-${unitId}`, schedule);
  }
  if (selected.size > MAX_OPTION_SCHEDULES) throw fail('SHIFT_SWAP_SCHEDULE_LIMIT', 'Há escalas demais para montar as opções com segurança.', 'CONFLICT');
  const groups = await Promise.all([...selected.values()].map(async (schedule) => ({ schedule,
    shifts: (await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts
      .filter((shift) => typeof shift.date === 'string' && shift.date > today && shift.date <= end)
      .map((shift) => logicalShift(schedule.ref.collection('shifts').doc(shift.id), shift)) })));
  const all = groups.flatMap(({ schedule, shifts }) => shifts.map((shift) => ({ schedule, shift })))
    .filter(({ shift }) => shift.get('type') === 'work' && text(shift.get('userId'), 180) && text(shift.get('unitId'), 180)
      && text(shift.get('startTime'), 8) && text(shift.get('endTime'), 8));
  const own = all.filter(({ shift }) => shift.get('userId') === context.decoded.uid);
  const ownKeys = new Set(own.map(({ shift }) => `${shift.get('unitId')}|${shift.get('date')}`));
  const candidates = all.filter(({ shift }) => shift.get('userId') !== context.decoded.uid && ownKeys.has(`${shift.get('unitId')}|${shift.get('date')}`));
  const included = [...own, ...candidates];
  if (included.length > MAX_OPTIONS) throw fail('SHIFT_SWAP_OPTIONS_LIMIT', 'Há turnos demais para montar as opções com segurança.', 'CONFLICT');
  const unitIds = [...new Set(included.map(({ shift }) => String(shift.get('unitId'))))];
  const definitionIds = [...new Set(included.map(({ shift }) => text(shift.get('shiftDefinitionId'), 180)).filter((value): value is string => Boolean(value)))];
  const userIds = [...new Set(included.map(({ shift }) => String(shift.get('userId'))))];
  const [unitDocs, definitionDocs, userDocs] = await Promise.all([
    unitIds.length ? dbAdmin.getAll(...unitIds.map((id) => dbAdmin.collection('dp_units').doc(id))) : [],
    definitionIds.length ? dbAdmin.getAll(...definitionIds.map((id) => dbAdmin.collection('dp_shiftDefinitions').doc(id))) : [],
    userIds.length ? dbAdmin.getAll(...userIds.map((id) => dbAdmin.collection('users').doc(id))) : [],
  ]);
  const units = new Map(unitDocs.map((doc) => [doc.id, String(doc.get('name') ?? 'Unidade')]));
  const definitions = new Map(definitionDocs.map((doc) => [doc.id, text(doc.get('name'), 180)]));
  const users = new Map(userDocs.filter((doc) => doc.exists && doc.get('isActive') !== false).map((doc) => [doc.id, displayName(doc, doc.id)]));
  const format = ({ schedule, shift }: { schedule: QueryDocumentSnapshot; shift: ShiftDocument }) => option(shift, schedule.id,
    units.get(String(shift.get('unitId'))) ?? 'Unidade', definitions.get(String(shift.get('shiftDefinitionId') ?? '')) ?? null,
    users.get(String(shift.get('userId'))) ?? 'Colaborador');
  return {
    ownShifts: own.filter(({ shift }) => users.has(String(shift.get('userId')))).map(format).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
    candidateShifts: candidates.filter(({ shift }) => users.has(String(shift.get('userId')))).map(format).sort((a, b) => `${a.date}${a.startTime}${a.occupantName}`.localeCompare(`${b.date}${b.startTime}${b.occupantName}`)),
    through: end,
  };
}

function shiftSnapshot(document: ShiftDocument, scheduleId: string, unit: DocumentSnapshot, definition: DocumentSnapshot | null, user: DocumentSnapshot): ShiftSwapShift {
  const data = document.data() ?? {};
  return {
    scheduleId, shiftId: document.id, unitId: String(data.unitId ?? ''), unitName: String(unit.get('name') ?? 'Unidade'),
    date: String(data.date ?? ''), startTime: String(data.startTime ?? ''), endTime: String(data.endTime ?? ''),
    shiftDefinitionId: text(data.shiftDefinitionId, 180), shiftName: definition?.exists ? text(definition.get('name'), 180) : null,
    occupantUid: user.id, occupantName: displayName(user, user.id), fingerprint: shiftFingerprint(data),
  };
}
type StoredShiftSwapEvent = Omit<ShiftSwapEvent, 'at'> & { at: Timestamp; operationFingerprint: string };
function event(action: ShiftSwapEvent['action'], at: Timestamp, evidence: ShiftSwapIdentityEvidence, declaration: string,
  operationFingerprint: string): StoredShiftSwapEvent {
  return { action, at, actorUid: evidence.authenticatedUid, actorName: evidence.actorName, declaration, evidence, operationFingerprint };
}
function notificationPayload(requestId: string, recipientUid: string, kind: string, workspaceId: string, at: Timestamp, body: string) {
  const eventId = stableUuid(`shift-swap:${requestId}:${kind}:${recipientUid}`);
  return {
    id: digest(`shift-swap:${requestId}:${kind}:${recipientUid}`),
    notification: { recipientUid, eventId, path: '/dashboard/collaborator/requests' as const },
    data: { ownerUid: recipientUid, workspaceId, sourceEventId: `dp_shiftSwapRequests/${requestId}/${kind}`,
      eventId, title: 'Troca de turno', body, path: '/dashboard/collaborator/requests', readAt: null, createdAt: at },
  };
}
function audit(context: ServerUserContext, action: string, requestId: string, operationId: string, now: Timestamp, metadata: Record<string, unknown>) {
  return { workspace_id: context.workspace_id, user_id: context.decoded.uid, username: context.userDoc.username ?? null,
    module: 'dp.shift-swaps', action, metadata: { request_id: requestId, operation_id: operationId, ...metadata },
    ip_address: null, timestamp: now, ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS) };
}

export async function createShiftSwap(context: ServerUserContext, input: CreateShiftSwapInput, evidence: ShiftSwapIdentityEvidence) {
  assertActorMayRequest(context);
  if (input.offeredShiftId === input.requestedShiftId) throw fail('SHIFT_SWAP_SAME_SHIFT', 'Escolha dois turnos diferentes.');
  const requestId = digest(['shift-swap', context.workspace_id, context.decoded.uid, input.operationId]);
  const requestRef = dbAdmin.collection(REQUESTS).doc(requestId);
  const operationFingerprint = digest({ scheduleId: input.scheduleId, offeredShiftId: input.offeredShiftId,
    requestedShiftId: input.requestedShiftId, reason: input.reason ?? null });
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(input.scheduleId);
  const offeredRef = scheduleRef.collection('shifts').doc(input.offeredShiftId);
  const requestedRef = scheduleRef.collection('shifts').doc(input.requestedShiftId);
  const today = todayInBelem();
  const result = await dbAdmin.runTransaction(async (tx) => {
    const existing = await tx.get(requestRef);
    if (existing.exists) {
      const stored = serializeShiftSwap(existing.id, existing.data() ?? {});
      const first = stored.events[0]?.evidence.operationId;
      if (first !== input.operationId || existing.get('operationFingerprint') !== operationFingerprint) {
        throw fail('SHIFT_SWAP_OPERATION_CONFLICT', 'A tentativa já foi usada com outro conteúdo.', 'CONFLICT');
      }
      return { request: stored, notification: null as Notification | null };
    }
    const schedule = await tx.get(scheduleRef);
    const [offered, requested] = await Promise.all([transactionShift(tx, schedule, offeredRef), transactionShift(tx, schedule, requestedRef)]);
    if (!schedule.exists || !offered.exists || !requested.exists) throw fail('SHIFT_SWAP_SHIFT_NOT_FOUND', 'Um dos turnos não está mais disponível.', 'NOT_FOUND');
    const offeredUid = String(offered.get('userId') ?? '');
    const requestedUid = String(requested.get('userId') ?? '');
    const unitId = String(offered.get('unitId') ?? '');
    if (offeredUid !== context.decoded.uid) throw fail('SHIFT_SWAP_OFFER_OWNER_REQUIRED', 'Você só pode oferecer o seu próprio turno.', 'AUTHORIZATION');
    if (!requestedUid || requestedUid === offeredUid) throw fail('SHIFT_SWAP_TARGET_INVALID', 'Escolha o turno de outra pessoa.');
    if (offered.get('type') !== 'work' || requested.get('type') !== 'work'
      || requested.get('unitId') !== unitId || requested.get('date') !== offered.get('date')) {
      throw fail('SHIFT_SWAP_PAIR_INVALID', 'A troca exige dois turnos de trabalho da mesma unidade e da mesma data.');
    }
    const date = String(offered.get('date') ?? '');
    if (date <= today) throw fail('SHIFT_SWAP_NOT_FUTURE', 'A troca precisa ser solicitada antes do dia dos turnos.', 'CONFLICT');
    if (schedule.get('unitId') !== unitId) throw fail('SHIFT_SWAP_SCHEDULE_UNIT_MISMATCH', 'A escala e a unidade dos turnos não correspondem.', 'DATA_INTEGRITY');
    const [requester, target, unit, offeredDefinition, requestedDefinition, offeredPending, requestedPending] = await Promise.all([
      tx.get(dbAdmin.collection('users').doc(offeredUid)), tx.get(dbAdmin.collection('users').doc(requestedUid)),
      tx.get(dbAdmin.collection('dp_units').doc(unitId)),
      text(offered.get('shiftDefinitionId'), 180) ? tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(String(offered.get('shiftDefinitionId')))) : null,
      text(requested.get('shiftDefinitionId'), 180) ? tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(String(requested.get('shiftDefinitionId')))) : null,
      tx.get(dbAdmin.collection(REQUESTS).where('workspaceId', '==', context.workspace_id)
        .where('shiftKeys', 'array-contains', shiftKey(input.scheduleId, input.offeredShiftId)).limit(20)),
      tx.get(dbAdmin.collection(REQUESTS).where('workspaceId', '==', context.workspace_id)
        .where('shiftKeys', 'array-contains', shiftKey(input.scheduleId, input.requestedShiftId)).limit(20)),
    ]);
    if (!requester.exists || requester.get('isActive') === false || !target.exists || target.get('isActive') === false) {
      throw fail('SHIFT_SWAP_PARTICIPANT_UNAVAILABLE', 'Uma das pessoas não está ativa no cadastro.', 'CONFLICT');
    }
    if (!unit.exists || unit.get('isArchived') === true) throw fail('SHIFT_SWAP_UNIT_UNAVAILABLE', 'A unidade não está disponível.', 'CONFLICT');
    if ([...offeredPending.docs, ...requestedPending.docs].some((doc) => doc.get('status') === 'pending')) {
      throw fail('SHIFT_SWAP_ALREADY_PENDING', 'Já existe uma troca pendente envolvendo um dos turnos.', 'CONFLICT');
    }
    const offeredSnapshot = shiftSnapshot(offered, input.scheduleId, unit, offeredDefinition, requester);
    const requestedSnapshot = shiftSnapshot(requested, input.scheduleId, unit, requestedDefinition, target);
    const now = Timestamp.now();
    const firstEvent = event('submitted', now, evidence,
      `Solicito trocar meu turno de ${date}, ${offeredSnapshot.startTime}–${offeredSnapshot.endTime}, pelo turno de ${requestedSnapshot.occupantName}, ${requestedSnapshot.startTime}–${requestedSnapshot.endTime}.`, operationFingerprint);
    const value = {
      schemaVersion: 1, workspaceId: context.workspace_id, workDate: date, unitId, status: 'pending', version: 1,
      requesterUid: offeredUid, requesterName: offeredSnapshot.occupantName, targetUid: requestedUid, targetName: requestedSnapshot.occupantName,
      participantUids: [offeredUid, requestedUid], shiftKeys: [shiftKey(input.scheduleId, input.offeredShiftId), shiftKey(input.scheduleId, input.requestedShiftId)],
      offeredShift: offeredSnapshot, requestedShift: requestedSnapshot, reason: input.reason ?? null,
      operationFingerprint, events: [firstEvent], createdAt: now, updatedAt: now, decidedAt: null,
    };
    const notice = notificationPayload(requestId, requestedUid, 'submitted-v1', context.workspace_id, now,
      `${offeredSnapshot.occupantName} propôs trocar o turno de ${date}. Abra Solicitações para aceitar ou recusar.`);
    tx.create(requestRef, value);
    tx.create(dbAdmin.collection('userNotifications').doc(notice.id), notice.data);
    tx.create(dbAdmin.collection('actionLogs').doc(), audit(context, 'shift_swap_submitted', requestId, input.operationId, now,
      { schedule_id: input.scheduleId, offered_shift_id: input.offeredShiftId, requested_shift_id: input.requestedShiftId, target_uid: requestedUid, date, unit_id: unitId }));
    return { request: serializeShiftSwap(requestId, value), notification: notice.notification };
  });
  return result;
}

export async function listOwnShiftSwaps(context: ServerUserContext) {
  assertActorMayRequest(context);
  const snapshot = await dbAdmin.collection(REQUESTS).where('workspaceId', '==', context.workspace_id)
    .where('participantUids', 'array-contains', context.decoded.uid).limit(100).get();
  return snapshot.docs.map((doc) => serializeShiftSwap(doc.id, doc.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function isScheduleShift(document: QueryDocumentSnapshot) {
  const parts = document.ref.path.split('/');
  return parts.length === 4 && parts[0] === 'dp_schedules' && parts[2] === 'shifts';
}

async function buildIncomingReference(params: {
  tx: Transaction;
  user: DocumentSnapshot;
  unit: DocumentSnapshot;
  definition: DocumentSnapshot | null;
  journeys: DPJourney[];
  shift: ShiftDocument;
  scheduleId: string;
  previousRevisionId: string | null;
  actorUid: string;
  requestId: string;
  now: Timestamp;
}) {
  const { tx, user, unit, definition, journeys, shift, scheduleId, previousRevisionId, actorUid, requestId, now } = params;
  const primaryUnitId = text(user.get('unitId'), 180) ?? unit.id;
  const primary = primaryUnitId === unit.id ? unit : await tx.get(dbAdmin.collection('dp_units').doc(primaryUnitId));
  if (!primary.exists || primary.get('isArchived') === true) throw fail('SHIFT_SWAP_PRIMARY_UNIT_INVALID', 'A unidade principal de uma das pessoas precisa ser corrigida.', 'DATA_INTEGRITY');
  const groupId = text(primary.get('groupId'), 180);
  const group = groupId ? await tx.get(dbAdmin.collection('dp_unitGroups').doc(groupId)) : null;
  const organizationId = text(primary.get('organizationId'), 180) ?? (group?.exists ? text(group.get('organizationId'), 180) : null);
  const date = String(shift.get('date') ?? '');
  const resolution = resolveDPJourney({ journeys, date, target: {
    collaboratorId: user.id, jobRoleId: text(user.get('jobRoleId'), 180) ?? undefined,
    jobFunctionIds: strings(user.get('jobFunctionIds')), unitId: primaryUnitId,
    ...(groupId ? { unitGroupId: groupId } : {}), ...(organizationId ? { unitOrganizationId: organizationId } : {}),
  } });
  if (resolution.status === 'none') throw fail('SHIFT_SWAP_JOURNEY_NOT_FOUND', 'Uma das pessoas não possui jornada vigente para esse dia.', 'CONFLICT');
  if (resolution.status === 'ambiguous') throw fail('SHIFT_SWAP_JOURNEY_AMBIGUOUS', 'Há mais de uma jornada aplicável a uma das pessoas.', 'CONFLICT');
  if (!isShiftDefinitionCompatibleWithJourney({ journeyId: resolution.journey.id,
    journeyAllowedShiftDefinitionIds: resolution.journey.allowedShiftDefinitionIds,
    shiftDefinitionId: definition?.id ?? null, shiftJourneyIds: definition?.get('journeyIds') })) {
    throw fail('SHIFT_SWAP_JOURNEY_INCOMPATIBLE', 'O turno não é compatível com a jornada de uma das pessoas.', 'CONFLICT');
  }
  const ref = dbAdmin.collection(REFERENCE_HISTORY).doc();
  const reference = buildDPShiftReference({ collaboratorId: user.id, user: user.data() ?? {}, journey: resolution.journey,
    resolvedBy: resolution.resolvedBy, definition: definition?.exists ? { id: definition.id, ...definition.data() } as DPShiftDefinition : null,
    executionUnitId: unit.id, date, startTime: String(shift.get('startTime') ?? ''), endTime: String(shift.get('endTime') ?? ''), capturedAt: now.toDate().toISOString() });
  return { ref, data: { scheduleId, shiftId: shift.id, shiftPath: shift.ref.path, userId: user.id,
    actorId: actorUid, requestId, event: 'shift_swap_accepted', previousRevisionId, reference, capturedAt: now }, resolution };
}

export async function decideShiftSwap(context: ServerUserContext, requestId: string, input: DecideShiftSwapInput, evidence: ShiftSwapIdentityEvidence) {
  assertActorMayRequest(context);
  const requestRef = dbAdmin.collection(REQUESTS).doc(requestId);
  const today = todayInBelem();
  return dbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(requestRef);
    if (!current.exists || current.get('workspaceId') !== context.workspace_id) throw fail('SHIFT_SWAP_NOT_FOUND', 'Solicitação de troca não encontrada.', 'NOT_FOUND');
    const stored = serializeShiftSwap(current.id, current.data() ?? {});
    const operationFingerprint = digest({ action: input.action, expectedVersion: input.expectedVersion,
      reason: input.action === 'reject' ? input.reason : null });
    const rawEvents = Array.isArray(current.get('events')) ? current.get('events') as Array<Record<string, unknown>> : [];
    const replay = rawEvents.find((item) => (item.evidence as Record<string, unknown> | undefined)?.operationId === input.operationId);
    if (replay) {
      if (replay.operationFingerprint !== operationFingerprint) {
        throw fail('SHIFT_SWAP_OPERATION_CONFLICT', 'A tentativa já foi usada com outro conteúdo.', 'CONFLICT');
      }
      return { request: stored, notification: null as Notification | null };
    }
    if (stored.version !== input.expectedVersion || stored.status !== 'pending') throw fail('SHIFT_SWAP_VERSION_CONFLICT', 'A solicitação mudou. Atualize antes de continuar.', 'CONFLICT');
    if (input.action === 'cancel' && context.decoded.uid !== stored.requesterUid) throw fail('SHIFT_SWAP_CANCEL_OWNER_REQUIRED', 'Somente quem solicitou pode cancelar.', 'AUTHORIZATION');
    if (input.action !== 'cancel' && context.decoded.uid !== stored.targetUid) throw fail('SHIFT_SWAP_TARGET_DECISION_REQUIRED', 'Somente a pessoa convidada pode aceitar ou recusar.', 'AUTHORIZATION');
    const now = Timestamp.now();
    const nextVersion = stored.version + 1;
    if (input.action === 'reject' || input.action === 'cancel') {
      const status = input.action === 'reject' ? 'rejected' : 'cancelled';
      const declaration = input.action === 'reject'
        ? `Recuso a troca proposta. Motivo: ${input.reason}`
        : 'Cancelo a proposta de troca antes do aceite da outra pessoa.';
      const nextEvent = event(input.action === 'reject' ? 'rejected' : 'cancelled', now, evidence, declaration, operationFingerprint);
      const recipientUid = input.action === 'reject' ? stored.requesterUid : stored.targetUid;
      const notice = notificationPayload(requestId, recipientUid, `${status}-v${nextVersion}`, context.workspace_id, now,
        input.action === 'reject' ? `${stored.targetName} recusou a troca de turno.` : `${stored.requesterName} cancelou a troca de turno.`);
      tx.update(requestRef, { status, version: nextVersion, events: FieldValue.arrayUnion(nextEvent), updatedAt: now, decidedAt: now });
      tx.create(dbAdmin.collection('userNotifications').doc(notice.id), notice.data);
      tx.create(dbAdmin.collection('actionLogs').doc(), audit(context, `shift_swap_${status}`, requestId, input.operationId, now, {}));
      return { request: { ...stored, status: status as ShiftSwapStatus, version: nextVersion, events: [...stored.events, { ...nextEvent, at: now.toDate().toISOString() }], updatedAt: now.toDate().toISOString(), decidedAt: now.toDate().toISOString() }, notification: notice.notification };
    }

    const scheduleRef = dbAdmin.collection('dp_schedules').doc(stored.offeredShift.scheduleId);
    const offeredRef = scheduleRef.collection('shifts').doc(stored.offeredShift.shiftId);
    const requestedRef = scheduleRef.collection('shifts').doc(stored.requestedShift.shiftId);
    const schedule = await tx.get(scheduleRef);
    const [offered, requested] = await Promise.all([transactionShift(tx, schedule, offeredRef), transactionShift(tx, schedule, requestedRef)]);
    if (!schedule.exists || !offered.exists || !requested.exists) throw fail('SHIFT_SWAP_SHIFT_NOT_FOUND', 'Um dos turnos deixou de existir.', 'CONFLICT');
    const stillValid = shiftFingerprint(offered.data() ?? {}) === stored.offeredShift.fingerprint
      && shiftFingerprint(requested.data() ?? {}) === stored.requestedShift.fingerprint
      && offered.get('userId') === stored.requesterUid && requested.get('userId') === stored.targetUid
      && offered.get('unitId') === requested.get('unitId') && offered.get('date') === requested.get('date')
      && offered.get('type') === 'work' && requested.get('type') === 'work';
    if (!stillValid || String(offered.get('date') ?? '') <= today) {
      const staleEvent = event('marked_stale', now, evidence, 'A troca não foi aplicada porque a escala mudou ou o dia já começou.', operationFingerprint);
      tx.update(requestRef, { status: 'stale', version: nextVersion, events: FieldValue.arrayUnion(staleEvent), updatedAt: now, decidedAt: now });
      return { request: { ...stored, status: 'stale' as const, version: nextVersion, events: [...stored.events, { ...staleEvent, at: now.toDate().toISOString() }], updatedAt: now.toDate().toISOString(), decidedAt: now.toDate().toISOString() }, notification: null };
    }
    const unitId = String(offered.get('unitId'));
    const date = String(offered.get('date'));
    const [requester, target, unit, offeredDefinition, requestedDefinition, journeysSnapshot, requesterOccupancies, targetOccupancies, requesterRevisionOccupancies, targetRevisionOccupancies] = await Promise.all([
      tx.get(dbAdmin.collection('users').doc(stored.requesterUid)), tx.get(dbAdmin.collection('users').doc(stored.targetUid)),
      tx.get(dbAdmin.collection('dp_units').doc(unitId)),
      text(offered.get('shiftDefinitionId'), 180) ? tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(String(offered.get('shiftDefinitionId')))) : null,
      text(requested.get('shiftDefinitionId'), 180) ? tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(String(requested.get('shiftDefinitionId')))) : null,
      tx.get(dbAdmin.collection('dp_journeys').where('status', 'in', ['published', 'archived']).limit(MAX_JOURNEYS + 1)),
      tx.get(dbAdmin.collectionGroup('shifts').where('userId', '==', stored.requesterUid).where('date', '==', date).limit(MAX_OCCUPANCIES)),
      tx.get(dbAdmin.collectionGroup('shifts').where('userId', '==', stored.targetUid).where('date', '==', date).limit(MAX_OCCUPANCIES)),
      readActiveRevisionPersonDay(tx, stored.requesterUid, date),
      readActiveRevisionPersonDay(tx, stored.targetUid, date),
    ]);
    if (!requester.exists || requester.get('isActive') === false || !target.exists || target.get('isActive') === false || !unit.exists || unit.get('isArchived') === true) {
      throw fail('SHIFT_SWAP_PARTICIPANT_UNAVAILABLE', 'Uma pessoa ou unidade deixou de estar disponível.', 'CONFLICT');
    }
    if (journeysSnapshot.size > MAX_JOURNEYS || requesterOccupancies.size === MAX_OCCUPANCIES || targetOccupancies.size === MAX_OCCUPANCIES) {
      throw fail('SHIFT_SWAP_VALIDATION_LIMIT', 'Não foi possível validar a troca com segurança.', 'DATA_INTEGRITY');
    }
    const selectedPaths = new Set([offeredRef.path, requestedRef.path]);
    const legacyOccupancies = [...requesterOccupancies.docs, ...targetOccupancies.docs].filter(isScheduleShift);
    const legacyScheduleRefs = [...new Map(legacyOccupancies.map((doc) => [doc.ref.parent.parent!.id, doc.ref.parent.parent!] as const)).values()];
    const legacySchedules = legacyScheduleRefs.length ? await tx.getAll(...legacyScheduleRefs) : [];
    const pointerIds = new Set(legacySchedules.filter((item) => item.get('activeRevisionId')).map((item) => item.id));
    const extraLegacy = legacyOccupancies.filter((doc) => !pointerIds.has(doc.ref.parent.parent!.id) && !selectedPaths.has(doc.ref.path));
    const extraRevision = [...requesterRevisionOccupancies, ...targetRevisionOccupancies]
      .filter((item) => !selectedPaths.has(`dp_schedules/${item.scheduleId}/shifts/${item.id}`));
    if (extraLegacy.length || extraRevision.length) throw fail('SHIFT_SWAP_OTHER_OCCUPANCY', 'Uma das pessoas possui outro turno ou folga nessa data.', 'CONFLICT');
    const journeys = journeysSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DPJourney));
    const [newOfferedReference, newRequestedReference] = await Promise.all([
      buildIncomingReference({ tx, user: target, unit, definition: offeredDefinition, journeys, shift: offered,
        scheduleId: schedule.id, previousRevisionId: text(offered.get('referenceRevisionId'), 180), actorUid: context.decoded.uid, requestId, now }),
      buildIncomingReference({ tx, user: requester, unit, definition: requestedDefinition, journeys, shift: requested,
        scheduleId: schedule.id, previousRevisionId: text(requested.get('referenceRevisionId'), 180), actorUid: context.decoded.uid, requestId, now }),
    ]);
    const offeredPatch = { userId: stored.targetUid, userName: stored.targetName, referenceRevisionId: newOfferedReference.ref.id,
      journeyResolution: { journeyId: newOfferedReference.resolution.journey.id, lineageId: newOfferedReference.resolution.journey.lineageId,
        version: newOfferedReference.resolution.journey.version, name: newOfferedReference.resolution.journey.name,
        resolvedBy: newOfferedReference.resolution.resolvedBy, validationMode: newOfferedReference.resolution.journey.scaleValidation?.mode ?? 'consecutive_days',
        maxConsecutiveWorkDays: newOfferedReference.resolution.journey.weeklyRest?.maxConsecutiveWorkDays ?? 6, resolvedAt: now },
      shiftSwapRequestId: requestId, updatedAt: now };
    const requestedPatch = { userId: stored.requesterUid, userName: stored.requesterName, referenceRevisionId: newRequestedReference.ref.id,
      journeyResolution: { journeyId: newRequestedReference.resolution.journey.id, lineageId: newRequestedReference.resolution.journey.lineageId,
        version: newRequestedReference.resolution.journey.version, name: newRequestedReference.resolution.journey.name,
        resolvedBy: newRequestedReference.resolution.resolvedBy, validationMode: newRequestedReference.resolution.journey.scaleValidation?.mode ?? 'consecutive_days',
        maxConsecutiveWorkDays: newRequestedReference.resolution.journey.weeklyRest?.maxConsecutiveWorkDays ?? 6, resolvedAt: now },
      shiftSwapRequestId: requestId, updatedAt: now };
    const preparedOverlay = schedule.get('activeRevisionId')
      ? await prepareActiveRevisionOperationalChanges({ tx, schedule, workspaceId: context.workspace_id, actorId: context.decoded.uid,
        reason: 'shift_swap_accepted', changes: [
          { shiftId: offered.id, previous: offered.data() ?? null, next: { ...offered.data(), ...offeredPatch } },
          { shiftId: requested.id, previous: requested.data() ?? null, next: { ...requested.data(), ...requestedPatch } },
        ] }) : null;
    const publicationFence = preparedOverlay ? null : await preparePublicationFenceAdvance(tx,
      context.workspace_id, [stored.requesterUid, stored.targetUid]);
    if (operationalGuardRequested()) {
      await guardOccupancyWrite(tx, context.workspace_id, [
        ...shiftOccupancySlices({ beneficiaryUid: stored.requesterUid, date, startTime: String(offered.get('startTime')), endTime: String(offered.get('endTime')), addsOccupancy: false }),
        ...shiftOccupancySlices({ beneficiaryUid: stored.targetUid, date, startTime: String(requested.get('startTime')), endTime: String(requested.get('endTime')), addsOccupancy: false }),
        ...shiftOccupancySlices({ beneficiaryUid: stored.targetUid, date, startTime: String(offered.get('startTime')), endTime: String(offered.get('endTime')), addsOccupancy: true }),
        ...shiftOccupancySlices({ beneficiaryUid: stored.requesterUid, date, startTime: String(requested.get('startTime')), endTime: String(requested.get('endTime')), addsOccupancy: true }),
      ], 8);
    }
    const accepted = event('accepted', now, evidence,
      `Aceito trocar meu turno de ${date}, ${requested.get('startTime')}–${requested.get('endTime')}, pelo turno de ${stored.requesterName}, ${offered.get('startTime')}–${offered.get('endTime')}.`, operationFingerprint);
    if (preparedOverlay) preparedOverlay.apply();
    else {
      publicationFence?.apply();
      tx.update(offeredRef, offeredPatch);
      tx.update(requestedRef, requestedPatch);
    }
    tx.create(newOfferedReference.ref, { ...newOfferedReference.data, workspaceId: context.workspace_id });
    tx.create(newRequestedReference.ref, { ...newRequestedReference.data, workspaceId: context.workspace_id });
    tx.update(scheduleRef, { ...(preparedOverlay ? {} : { goalEligibilityVersion: FieldValue.increment(1), journeyValidationVersion: FieldValue.increment(1) }),
      lastAuthorizedShiftSwapAt: now, lastAuthorizedShiftSwapRequestId: requestId });
    tx.update(requestRef, { status: 'accepted', version: nextVersion, events: FieldValue.arrayUnion(accepted), updatedAt: now, decidedAt: now,
      applied: { at: now, scheduleId: schedule.id, offeredReferenceRevisionId: newOfferedReference.ref.id, requestedReferenceRevisionId: newRequestedReference.ref.id } });
    const notice = notificationPayload(requestId, stored.requesterUid, `accepted-v${nextVersion}`, context.workspace_id, now,
      `${stored.targetName} aceitou a troca. A escala foi atualizada automaticamente.`);
    tx.create(dbAdmin.collection('userNotifications').doc(notice.id), notice.data);
    tx.create(dbAdmin.collection('actionLogs').doc(), audit(context, 'shift_swap_accepted', requestId, input.operationId, now,
      { schedule_id: schedule.id, date, unit_id: unitId, offered_shift_id: offered.id, requested_shift_id: requested.id,
        requester_uid: stored.requesterUid, target_uid: stored.targetUid }));
    return { request: { ...stored, status: 'accepted' as const, version: nextVersion, events: [...stored.events, { ...accepted, at: now.toDate().toISOString() }], updatedAt: now.toDate().toISOString(), decidedAt: now.toDate().toISOString() }, notification: notice.notification };
  });
}
