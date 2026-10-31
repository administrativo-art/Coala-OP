import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentSnapshot, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { holdRepPCompetenceForSchedulePublication } from '@/features/dp/rep-p/competence-fence.server';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { hasPublishedScheduleVersion, mergeScheduleDraft, scheduleShiftFingerprint, type DPScheduleDraftEdit } from '@/lib/dp-schedule-publication';
import type { SaveWorkShiftInput, BulkWorkShiftInput } from '@/features/dp/shifts/schemas';
import { validateScheduleJourneys } from '@/features/dp/journey-validation/service.server';
import { resolveDPShiftAssignment } from '@/lib/dp-external-coverage';
import { buildDPShiftReference } from '@/lib/dp-shift-reference';
import type { DPJourney, DPShiftDefinition } from '@/types';
import { readOfficialScheduleShifts } from './official-revision.server';
import { capturePublicationFence, preparePublicationFenceCommit } from './publication-fence.server';
import { prepareScheduleRevision } from './revision-preparation.server';
import { validatePublicationOccupancy } from './publication-validation.server';

export const MAX_PUBLICATION_CHANGES = 500;
const MAX_OFFICIAL_SHIFTS = 2_000;
const MAX_DRAFT_EDITS = 500;
type Shift = Record<string, unknown>;
type DraftDocument = DPScheduleDraftEdit<Shift>;

function fail(code: string, kind: 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION' | 'DATA_INTEGRITY', safeMessage: string): never {
  throw new AppError({ code, kind, safeMessage });
}
function assertAccess(context: ServerUserContext, schedule: DocumentSnapshot, permission: 'view' | 'edit' | 'publish') {
  if (!schedule.exists) fail('DP_SCHEDULE_NOT_FOUND', 'NOT_FOUND', 'Escala não encontrada.');
  if (!context.isDefaultAdmin && context.permissions.dp.schedules[permission] !== true) fail('DP_SCHEDULE_DRAFT_FORBIDDEN', 'AUTHORIZATION', 'Sem permissão para esta operação na escala.');
  const unitId = schedule.get('unitId');
  if (typeof unitId !== 'string' || !canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
    fail('DP_SCHEDULE_UNIT_FORBIDDEN', 'AUTHORIZATION', 'Sem acesso à unidade desta escala.');
  }
  return unitId as string;
}
function publicationVersion(schedule: DocumentSnapshot) {
  const value = schedule.get('publicationVersion');
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) fail('DP_SCHEDULE_PUBLICATION_VERSION_INVALID', 'DATA_INTEGRITY', 'A revisão da escala está inconsistente.');
  return value as number;
}
function draftVersion(schedule: DocumentSnapshot) {
  const value = schedule.get('draftVersion') ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) fail('DP_SCHEDULE_DRAFT_VERSION_INVALID', 'DATA_INTEGRITY', 'A revisão do rascunho está inconsistente.');
  return value as number;
}
function draftGeneration(schedule: DocumentSnapshot) {
  const value = schedule.get('draftGenerationId') ?? 'initial';
  if (typeof value !== 'string' || !value || value.includes('/')) fail('DP_SCHEDULE_DRAFT_GENERATION_INVALID', 'DATA_INTEGRITY', 'A geração do rascunho está inconsistente.');
  return value as string;
}
function editId(generation: string, shiftId: string) {
  if (!shiftId || shiftId.includes('/')) fail('DP_SHIFT_ID_INVALID', 'VALIDATION', 'Identificador de turno inválido.');
  return `${generation}_${shiftId}`;
}
function raw(document: DocumentSnapshot | QueryDocumentSnapshot): Shift { return document.data() ?? {}; }
function draft(document: DocumentSnapshot | QueryDocumentSnapshot): DraftDocument {
  const data = raw(document);
  if (typeof data.baseFingerprint !== 'string' || (data.value !== null && (typeof data.value !== 'object' || Array.isArray(data.value)))) {
    fail('DP_SCHEDULE_DRAFT_CORRUPT', 'DATA_INTEGRITY', 'O rascunho da escala está inconsistente.');
  }
  return { baseFingerprint: data.baseFingerprint as string, value: data.value as Shift | null };
}
function assertPeriod(schedule: DocumentSnapshot, date: string, unitId: string, inputUnitId: string) {
  const month = Number(schedule.get('month')); const year = Number(schedule.get('year'));
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || !date.startsWith(`${year}-${String(month).padStart(2, '0')}-`) || unitId !== inputUnitId) {
    fail('DP_SCHEDULE_DRAFT_PERIOD_INVALID', 'VALIDATION', 'O turno não pertence à unidade ou competência da escala.');
  }
}
async function currentShifts(tx: Transaction, schedule: DocumentSnapshot, shiftIds: string[]) {
  if (!hasPublishedScheduleVersion(schedule.data() ?? {}) && !schedule.get('activeRevisionId')) {
    return shiftIds.map(() => null as Shift | null);
  }
  const pointer = schedule.get('activeRevisionId');
  if (!pointer) {
    const documents = shiftIds.length ? await tx.getAll(...shiftIds.map((id) => schedule.ref.collection('shifts').doc(id))) : [];
    return documents.map((document) => document.exists ? raw(document) : null);
  }
  if (typeof pointer !== 'string' || pointer.includes('/')) fail('DP_OFFICIAL_POINTER_INVALID', 'DATA_INTEGRITY', 'A revisão oficial está inconsistente.');
  const revision = schedule.ref.collection('revisions').doc(pointer);
  const overlay = schedule.ref.collection('operationalOverlays').doc(pointer);
  const manifest = await tx.get(revision);
  if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('scheduleId') !== schedule.id) {
    fail('DP_OFFICIAL_REVISION_INCOMPLETE', 'DATA_INTEGRITY', 'A revisão oficial está indisponível.');
  }
  const bases = shiftIds.length ? await tx.getAll(...shiftIds.map((id) => revision.collection('entries').doc(id))) : [];
  const overlays = shiftIds.length ? await tx.getAll(...shiftIds.map((id) => overlay.collection('entries').doc(id))) : [];
  return shiftIds.map((_, index) => overlays[index].exists ? (overlays[index].get('value') as Shift | null)
    : bases[index].exists ? raw(bases[index]) : null);
}
async function loadDraft(context: ServerUserContext, scheduleId: string, permission: 'view' | 'edit' | 'publish') {
  const ref = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const schedule = await ref.get();
  assertAccess(context, schedule, permission);
  const generation = draftGeneration(schedule);
  const [official, edits] = await Promise.all([
    readOfficialScheduleShifts({ scheduleId }),
    ref.collection('draftEdits').where('generationId', '==', generation).limit(MAX_DRAFT_EDITS + 1).get(),
  ]);
  if (official.shifts.length > MAX_OFFICIAL_SHIFTS || edits.size > MAX_DRAFT_EDITS) fail('DP_SCHEDULE_DRAFT_LIMIT', 'DATA_INTEGRITY', 'A escala excede o limite seguro para esta operação.');
  const published = new Map(official.shifts.map((item) => [item.id, item as Shift]));
  const pending = new Map(edits.docs.map((item) => {
    const shiftId = item.get('shiftId');
    if (typeof shiftId !== 'string' || item.id !== editId(generation, shiftId)) fail('DP_SCHEDULE_DRAFT_CORRUPT', 'DATA_INTEGRITY', 'O rascunho da escala está inconsistente.');
    return [shiftId, draft(item)] as const;
  }));
  return { ref, schedule, official, edits, generation, published, pending, ...mergeScheduleDraft(published, pending) };
}
export async function listEditableScheduleShifts(context: ServerUserContext, scheduleId: string) {
  const state = await loadDraft(context, scheduleId, 'edit');
  return { shifts: [...state.merged].map(([id, value]) => ({ id, ...value })).sort((a, b) => String((a as Shift).date).localeCompare(String((b as Shift).date))),
    conflicts: state.conflicts, draftVersion: draftVersion(state.schedule), draftGenerationId: state.generation };
}

/** Descartar conflitos é uma escolha explícita do DP; nunca rebaseia uma alteração operacional silenciosamente. */
export async function discardConflictingDraftShifts(context: ServerUserContext, scheduleId: string, expectedDraftVersion: number) {
  const state = await loadDraft(context, scheduleId, 'edit');
  if (draftVersion(state.schedule) !== expectedDraftVersion) fail('DP_SCHEDULE_DRAFT_STALE', 'CONFLICT', 'O rascunho mudou. Atualize a escala.');
  const ids = state.conflicts.slice(0, 200);
  if (!ids.length) return { discarded: 0, remaining: 0 };
  return dbAdmin.runTransaction(async (tx) => {
    const schedule = await tx.get(state.ref);
    assertAccess(context, schedule, 'edit');
    if (draftVersion(schedule) !== expectedDraftVersion || draftGeneration(schedule) !== state.generation
      || schedule.get('operationalVersion') !== state.schedule.get('operationalVersion')) {
      fail('DP_SCHEDULE_DRAFT_STALE', 'CONFLICT', 'A escala mudou. Atualize antes de resolver conflitos.');
    }
    const refs = ids.map((id) => state.ref.collection('draftEdits').doc(editId(state.generation, id)));
    const edits = await tx.getAll(...refs);
    if (edits.some((edit) => !edit.exists)) fail('DP_SCHEDULE_DRAFT_STALE', 'CONFLICT', 'O rascunho mudou. Atualize a escala.');
    refs.forEach((ref) => tx.delete(ref));
    const now = Timestamp.now();
    tx.update(state.ref, { draftVersion: expectedDraftVersion + 1, draftUpdatedAt: now,
      draftUpdatedBy: context.decoded.uid });
    tx.create(dbAdmin.collection('actionLogs').doc(), { workspace_id: context.workspace_id, user_id: context.decoded.uid,
      username: context.userDoc.username ?? null, module: 'dp.schedules', action: 'shift_draft_conflicts_discarded',
      metadata: { schedule_id: scheduleId, count: ids.length }, ip_address: null, timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + 365 * 24 * 60 * 60 * 1000) });
    return { discarded: ids.length, remaining: state.conflicts.length - ids.length };
  });
}

export async function stageWorkShift(params: { context: ServerUserContext; scheduleId: string; shiftId: string; input?: SaveWorkShiftInput; mode: 'create' | 'update' | 'delete'; requestId: string }) {
  const { context, scheduleId, shiftId, input, mode } = params;
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  return dbAdmin.runTransaction(async (tx) => {
    const schedule = await tx.get(scheduleRef);
    const unitId = assertAccess(context, schedule, 'edit');
    const generation = draftGeneration(schedule);
    const editRef = scheduleRef.collection('draftEdits').doc(editId(generation, shiftId));
    const [official] = await currentShifts(tx, schedule, [shiftId]);
    const [edit, editCount] = await Promise.all([tx.get(editRef),
      tx.get(scheduleRef.collection('draftEdits').where('generationId', '==', generation).limit(MAX_DRAFT_EDITS + 1))]);
    if (editCount.size >= MAX_DRAFT_EDITS && !edit.exists) fail('DP_SCHEDULE_DRAFT_LIMIT', 'DATA_INTEGRITY', 'O rascunho excede 500 turnos alterados.');
    const current = edit.exists ? draft(edit).value : official;
    if (mode === 'create' && current) fail('DP_SHIFT_ID_COLLISION', 'CONFLICT', 'O turno já existe no rascunho.');
    if (mode !== 'create' && !current) fail('DP_SHIFT_NOT_FOUND', 'NOT_FOUND', 'Turno não encontrado no rascunho.');
    if (current?.type === 'day_off') fail('DP_SHIFT_DAY_OFF_IMMUTABLE', 'CONFLICT', 'Uma folga não pode ser editada como turno.');
    if (input) {
      assertPeriod(schedule, input.date, unitId, input.unitId);
      const user = await tx.get(dbAdmin.collection('users').doc(input.userId));
      if (!user.exists || user.get('isActive') === false) fail('DP_SHIFT_USER_UNAVAILABLE', 'VALIDATION', 'Colaboradora não encontrada ou inativa.');
      if (input.shiftDefinitionId) {
        const definition = await tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(input.shiftDefinitionId));
        if (!definition.exists || definition.get('isArchived') === true) fail('DP_SHIFT_DEFINITION_UNAVAILABLE', 'VALIDATION', 'Definição de turno indisponível.');
      }
    }
    const now = Timestamp.now();
    const value = input ? {
      ...(current ?? {}), scheduleId, unitId, userId: input.userId,
      userName: input.userName ?? current?.userName ?? null, date: input.date,
      startTime: input.startTime, endTime: input.endTime, overnight: input.endTime < input.startTime,
      type: 'work', shiftDefinitionId: input.shiftDefinitionId ?? null,
      exceptionReason: input.exceptionReason ?? current?.exceptionReason ?? null,
      updatedAt: now, ...(mode === 'create' ? { createdAt: now } : {}),
    } : null;
    tx.set(editRef, { generationId: generation, shiftId,
      baseFingerprint: edit.exists ? draft(edit).baseFingerprint : scheduleShiftFingerprint(official),
      value, updatedAt: now, updatedBy: context.decoded.uid });
    tx.update(scheduleRef, { publicationStatus: 'draft', publicationVersion: schedule.get('publicationVersion') ?? (schedule.get('publicationStatus') === 'draft' ? 0 : 1),
      draftGenerationId: generation, draftVersion: draftVersion(schedule) + 1, draftUpdatedAt: now, draftUpdatedBy: context.decoded.uid });
    tx.create(dbAdmin.collection('actionLogs').doc(), { workspace_id: context.workspace_id, user_id: context.decoded.uid,
      username: context.userDoc.username ?? null, module: 'dp.schedules', action: 'shift_draft_changed',
      metadata: { request_id: params.requestId, schedule_id: scheduleId, shift_id: shiftId, mode },
      ip_address: null, timestamp: now, ttl: Timestamp.fromMillis(now.toMillis() + 365 * 24 * 60 * 60 * 1000) });
    return { shiftId, draft: true };
  });
}

export async function stageBulkWorkShift(params: { context: ServerUserContext; scheduleId: string; input: BulkWorkShiftInput; requestId: string }) {
  const { context, scheduleId, input, requestId } = params;
  const state = await loadDraft(context, scheduleId, 'edit');
  const scheduleRef = state.ref;
  if (input.action === 'create' && state.edits.size + input.entries.length > MAX_DRAFT_EDITS) fail('DP_SCHEDULE_DRAFT_LIMIT', 'DATA_INTEGRITY', 'O rascunho excede 500 turnos alterados.');
  const ids = input.action === 'create'
    ? input.entries.map(() => scheduleRef.collection('draftEdits').doc().id)
    : input.shiftIds;
  if (new Set(ids).size !== ids.length) fail('DP_SHIFT_BULK_DUPLICATE', 'VALIDATION', 'Há turnos repetidos na seleção.');
  const editRefs = ids.map((id) => scheduleRef.collection('draftEdits').doc(editId(state.generation, id)));
  return dbAdmin.runTransaction(async (tx) => {
    const schedule = await tx.get(scheduleRef);
    const unitId = assertAccess(context, schedule, 'edit');
    if (draftVersion(schedule) !== draftVersion(state.schedule) || draftGeneration(schedule) !== state.generation
      || schedule.get('activeRevisionId') !== state.schedule.get('activeRevisionId')
      || schedule.get('operationalVersion') !== state.schedule.get('operationalVersion')) {
      fail('DP_SCHEDULE_DRAFT_STALE', 'CONFLICT', 'A escala mudou. Atualize antes de editar em lote.');
    }
    const [official, edits] = await Promise.all([currentShifts(tx, schedule, ids), tx.getAll(...editRefs)]);
    if (state.edits.size + edits.filter((edit) => !edit.exists).length > MAX_DRAFT_EDITS) fail('DP_SCHEDULE_DRAFT_LIMIT', 'DATA_INTEGRITY', 'O rascunho excede 500 turnos alterados.');
    const targetUserIds = input.action === 'create' ? [...new Set(input.entries.map((entry) => entry.userId))]
      : input.action === 'replace' && input.patch.userId ? [input.patch.userId] : [];
    const targetUsers = targetUserIds.length ? await tx.getAll(...targetUserIds.map((id) => dbAdmin.collection('users').doc(id))) : [];
    if (targetUsers.some((user) => !user.exists || user.get('isActive') === false)) fail('DP_SHIFT_USER_UNAVAILABLE', 'VALIDATION', 'Colaboradora não encontrada ou inativa.');
    const definitionId = input.action === 'create' ? input.shiftDefinitionId
      : input.action === 'replace' ? input.patch.shiftDefinitionId : undefined;
    if (definitionId) {
      const definition = await tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(definitionId));
      if (!definition.exists || definition.get('isArchived') === true) fail('DP_SHIFT_DEFINITION_UNAVAILABLE', 'VALIDATION', 'Definição de turno indisponível.');
    }
    const now = Timestamp.now();
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const base = official[index];
      const existingEdit = edits[index].exists ? draft(edits[index]) : null;
      const current = existingEdit ? existingEdit.value : base;
      if (input.action === 'create' && current) fail('DP_SHIFT_ID_COLLISION', 'CONFLICT', 'Um turno já existe no rascunho.');
      if (input.action !== 'create' && !current) fail('DP_SHIFT_NOT_FOUND', 'NOT_FOUND', 'Um turno não existe no rascunho.');
      if (current?.type === 'day_off') fail('DP_SHIFT_DAY_OFF_IMMUTABLE', 'CONFLICT', 'Uma folga não pode ser editada em lote.');
      let value: Shift | null = null;
      if (input.action === 'create') {
        const entry = input.entries[index];
        assertPeriod(schedule, entry.date, unitId, unitId);
        value = { scheduleId, unitId, userId: entry.userId, date: entry.date,
          startTime: input.startTime, endTime: input.endTime, overnight: input.endTime < input.startTime,
          type: 'work', shiftDefinitionId: input.shiftDefinitionId, createdAt: now, updatedAt: now };
      } else if (input.action === 'replace' && current) {
        const patch = input.patch;
        value = { ...current, userId: patch.userId ?? current.userId,
          startTime: patch.startTime ?? current.startTime, endTime: patch.endTime ?? current.endTime,
          ...(patch.startTime && patch.endTime ? { overnight: patch.endTime < patch.startTime } : {}),
          ...(patch.shiftDefinitionId !== undefined ? { shiftDefinitionId: patch.shiftDefinitionId } : {}),
          ...(patch.exceptionReason ? { exceptionReason: patch.exceptionReason } : {}), updatedAt: now };
        assertPeriod(schedule, String(value.date), unitId, String(value.unitId));
      }
      tx.set(editRefs[index], { generationId: state.generation, shiftId: id,
        baseFingerprint: existingEdit?.baseFingerprint ?? scheduleShiftFingerprint(base),
        value, updatedAt: now, updatedBy: context.decoded.uid });
    }
    tx.update(scheduleRef, { publicationStatus: 'draft', publicationVersion: schedule.get('publicationVersion') ?? (schedule.get('publicationStatus') === 'draft' ? 0 : 1), draftGenerationId: state.generation, draftVersion: draftVersion(schedule) + 1,
      draftUpdatedAt: now, draftUpdatedBy: context.decoded.uid });
    tx.create(dbAdmin.collection('actionLogs').doc(), { workspace_id: context.workspace_id, user_id: context.decoded.uid,
      username: context.userDoc.username ?? null, module: 'dp.schedules', action: 'shift_draft_bulk_changed',
      metadata: { request_id: requestId, schedule_id: scheduleId, action: input.action, count: ids.length },
      ip_address: null, timestamp: now, ttl: Timestamp.fromMillis(now.toMillis() + 365 * 24 * 60 * 60 * 1000) });
    return { action: input.action, draft: true, created: input.action === 'create' ? ids.length : 0,
      updated: input.action === 'replace' ? ids.length : 0, deleted: input.action === 'delete' ? ids.length : 0, skipped: [] };
  });
}

export async function publishPreparedSchedule(context: ServerUserContext, scheduleId: string, requestId: string,
  expectedDraftVersion: number, onPrepared?: () => Promise<void>) {
  const state = await loadDraft(context, scheduleId, 'publish');
  if (state.schedule.get('publicationStatus') === 'published' && state.edits.empty) {
    return { publicationStatus: 'published' as const, publicationVersion: publicationVersion(state.schedule),
      shiftCount: Number(state.schedule.get('shiftCount') ?? 0), validation: state.schedule.get('journeyValidation') ?? null };
  }
  if (!context.isDefaultAdmin && context.permissions.dp.schedules.edit !== true) {
    fail('DP_SCHEDULE_EDIT_FORBIDDEN', 'AUTHORIZATION', 'Sem permissão para editar esta escala.');
  }
  if (draftVersion(state.schedule) !== expectedDraftVersion) fail('DP_SCHEDULE_DRAFT_STALE', 'CONFLICT', 'O rascunho mudou. Atualize a escala.');
  if (state.conflicts.length) fail('DP_SCHEDULE_DRAFT_CONFLICT', 'CONFLICT', 'Um turno editado mudou na escala oficial. Resolva o conflito.');
  if (state.edits.size > MAX_PUBLICATION_CHANGES || state.merged.size > MAX_OFFICIAL_SHIFTS) {
    fail('DP_SCHEDULE_PUBLICATION_LIMIT', 'DATA_INTEGRITY', 'A escala excede o limite seguro de 500 alterações ou 2.000 turnos.');
  }
  const unitId = String(state.schedule.get('unitId'));
  const year = Number(state.schedule.get('year'));
  const month = Number(state.schedule.get('month'));
  const workspaceId = state.schedule.get('workspaceId');
  if (typeof workspaceId !== 'string' || workspaceId !== context.workspace_id || !Number.isInteger(year) || !Number.isInteger(month)) {
    fail('DP_SCHEDULE_PUBLICATION_SCOPE_INVALID', 'DATA_INTEGRITY', 'O ambiente ou a competência da escala está inconsistente.');
  }
  const releaseClosureFence = await holdRepPCompetenceForSchedulePublication(
    repPDbAdmin, workspaceId, `${year}-${String(month).padStart(2, '0')}`);
  try {
  const oldVersion = publicationVersion(state.schedule);
  const oldOperationalVersion = Number(state.schedule.get('operationalVersion') ?? 0);
  if (!Number.isSafeInteger(oldOperationalVersion) || oldOperationalVersion < 0) fail('DP_SCHEDULE_OPERATIONAL_VERSION_INVALID', 'DATA_INTEGRITY', 'A versão operacional está inconsistente.');
  const changedIds = [...state.pending.keys()];
  const changedPeople = [...new Set(changedIds.flatMap((id) => [state.published.get(id)?.userId, state.pending.get(id)?.value?.userId]
    .filter((value): value is string => typeof value === 'string' && Boolean(value))))];
  if (changedPeople.length > 500) fail('DP_SCHEDULE_PUBLICATION_PARTICIPANT_LIMIT', 'DATA_INTEGRITY', 'A publicação excede 500 pessoas alteradas.');
  const allPeople = [...new Set([...state.merged.values()].map((shift) => shift.userId)
    .filter((value): value is string => typeof value === 'string' && Boolean(value)))];
  const fencePeople = [...new Set([...changedPeople, ...allPeople])];
  const capturedFence = await capturePublicationFence(context.workspace_id, fencePeople);
  const proposed = [...state.merged].map(([id, value]) => ({ ...value, id, scheduleId }));
  const validation = await validateScheduleJourneys({ context, scheduleId, proposedShifts: proposed });
  if (validation.status === 'blocked') fail('DP_SCHEDULE_JOURNEY_BLOCKED', 'VALIDATION', validation.issues[0]?.message ?? 'Revise as jornadas antes de publicar.');
  await validatePublicationOccupancy({ scheduleId, workspaceId, year, month, shifts: proposed });

  const unitRef = dbAdmin.collection('dp_units').doc(unitId);
  const userRefs = allPeople.map((id) => dbAdmin.collection('users').doc(id));
  const workIds = changedIds.filter((id) => state.pending.get(id)?.value?.type === 'work');
  const journeyIds = [...new Set(workIds.flatMap((id) => {
    const userId = state.pending.get(id)?.value?.userId;
    const journeyId = typeof userId === 'string' ? validation.people[userId]?.journey?.id : null;
    return journeyId ? [journeyId] : [];
  }))];
  const definitionIds = [...new Set(workIds.flatMap((id) => {
    const value = state.pending.get(id)?.value?.shiftDefinitionId;
    return typeof value === 'string' && value ? [value] : [];
  }))];
  const basisRefs = [unitRef, ...userRefs, ...journeyIds.map((id) => dbAdmin.collection('dp_journeys').doc(id)),
    ...definitionIds.map((id) => dbAdmin.collection('dp_shiftDefinitions').doc(id))];
  const basis = await dbAdmin.getAll(...basisRefs);
  if (basis.reduce((size, document) => size + Buffer.byteLength(JSON.stringify(document.data() ?? {})), 0) > 6 * 1024 * 1024) {
    fail('DP_SCHEDULE_PUBLICATION_BASIS_LIMIT', 'DATA_INTEGRITY', 'Dados de pessoas e jornadas excedem o limite seguro da transação.');
  }
  const basisTimes = basis.map((document) => [document.ref.path, document.updateTime?.toMillis() ?? null]);
  const unit = basis[0];
  if (!unit.exists || unit.get('isArchived') === true) fail('DP_SCHEDULE_UNIT_UNAVAILABLE', 'VALIDATION', 'A unidade da escala está indisponível.');
  const users = new Map(basis.slice(1, 1 + userRefs.length).map((document) => [document.id, document]));
  if ([...users.values()].some((document) => !document.exists || document.get('isActive') === false)) {
    fail('DP_SHIFT_USER_UNAVAILABLE', 'VALIDATION', 'Uma pessoa da escala está inativa ou indisponível.');
  }
  const journeys = new Map(basis.slice(1 + userRefs.length, 1 + userRefs.length + journeyIds.length)
    .map((document) => [document.id, document]));
  const definitions = new Map(basis.slice(1 + userRefs.length + journeyIds.length).map((document) => [document.id, document]));
  const stableAt = state.schedule.get('draftUpdatedAt') instanceof Timestamp
    ? state.schedule.get('draftUpdatedAt') as Timestamp : state.schedule.updateTime ?? Timestamp.now();
  const identity = { draftGenerationId: state.generation, draftVersion: expectedDraftVersion,
    operationalVersion: oldOperationalVersion, publicationVersion: oldVersion,
    baseRevisionId: typeof state.schedule.get('activeRevisionId') === 'string' ? state.schedule.get('activeRevisionId') as string : null };
  const revisionId = createHash('sha256').update(JSON.stringify({ scheduleId, identity, basisTimes }))
    .digest('hex').slice(0, 48);
  const entries = proposed.map((shift) => ({ id: shift.id, value: { ...shift } as Shift }));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const references: Array<{ id: string; value: Record<string, unknown> }> = [];
  for (const id of workIds) {
    const entry = entryById.get(id)!;
    const value = { ...entry.value };
    const userId = String(value.userId);
    const user = users.get(userId)!;
    const summary = validation.people[userId]?.journey;
    const journey = summary ? journeys.get(summary.id) : undefined;
    const definition = typeof value.shiftDefinitionId === 'string' ? definitions.get(value.shiftDefinitionId) : undefined;
    if (!summary || !journey?.exists || journey.get('version') !== summary.version
      || definition && (!definition.exists || definition.get('isArchived') === true)) {
      fail('DP_SCHEDULE_PUBLICATION_BASIS_CHANGED', 'CONFLICT', 'Dados de jornada ou turno mudaram. Revise a escala.');
    }
    const assignment = resolveDPShiftAssignment({ executionUnitId: unitId, date: String(value.date),
      executionUnitExternalId: typeof unit.get('externalId') === 'string' ? unit.get('externalId') : undefined,
      user: user.data() ?? {} });
    if (assignment.assignmentKind === 'external_coverage'
      && ((!context.isDefaultAdmin && context.permissions.dp.schedules.assignExternal !== true) || !value.exceptionReason)) {
      fail('DP_SHIFT_EXTERNAL_FORBIDDEN', 'AUTHORIZATION', 'Cobertura externa exige permissão e motivo.');
    }
    const referenceId = `rev_${revisionId}_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`;
    const reference = buildDPShiftReference({ collaboratorId: userId, user: user.data() ?? {},
      journey: { id: journey.id, ...journey.data() } as DPJourney, resolvedBy: summary.resolvedBy,
      definition: definition?.exists ? { id: definition.id, ...definition.data() } as DPShiftDefinition : null,
      executionUnitId: unitId, date: String(value.date), startTime: String(value.startTime),
      endTime: String(value.endTime), capturedAt: stableAt.toDate().toISOString() });
    const previous = state.published.get(id) ?? null;
    if (assignment.assignmentKind === 'regular') { delete value.originUnitId; delete value.exceptionReason; }
    entry.value = { ...value, userName: user.get('username') ?? null,
      assignmentKind: assignment.assignmentKind, countsTowardGoals: assignment.countsTowardGoals,
      ...(assignment.assignmentKind === 'external_coverage' ? { originUnitId: assignment.originUnitId } : {}),
      journeyResolution: { journeyId: summary.id, lineageId: summary.lineageId, version: summary.version,
        name: summary.name, resolvedBy: summary.resolvedBy, validationMode: summary.validationMode,
        maxConsecutiveWorkDays: summary.maxConsecutiveWorkDays, resolvedAt: stableAt },
      referenceRevisionId: referenceId, updatedAt: stableAt };
    references.push({ id: referenceId, value: { workspaceId, scheduleId, shiftId: id,
      shiftPath: state.ref.collection('revisions').doc(revisionId).collection('entries').doc(id).path,
      userId, actorId: context.decoded.uid, requestId, event: previous ? 'revised' : 'created',
      previousRevisionId: previous?.referenceRevisionId ?? null, reference, capturedAt: stableAt } });
  }
  const perPerson = new Map<string, Array<Shift & { id: string }>>();
  entries.forEach(({ id, value }) => {
    const userId = String(value.userId);
    perPerson.set(userId, [...(perPerson.get(userId) ?? []), { ...value, id }]);
  });
  if ([...perPerson.values()].some((row) => row.length > 62)) {
    fail('DP_SCHEDULE_PERSON_ROW_LIMIT', 'DATA_INTEGRITY', 'Uma pessoa possui turnos demais nesta escala.');
  }
  const people = [...perPerson].map(([userId, shifts]) => ({ userId, shifts }));
  const snapshotUsers = Object.fromEntries([...users].map(([userId, document]) => [userId, {
    username: String(document.get('username') ?? ''),
    ...(typeof document.get('color') === 'string' ? { color: document.get('color') } : {}),
    ...(typeof document.get('avatarUrl') === 'string' ? { avatarUrl: document.get('avatarUrl') } : {}),
    ...(typeof document.get('needsTransportVoucher') === 'boolean' ? { needsTransportVoucher: document.get('needsTransportVoucher') } : {}),
    ...(typeof document.get('transportVoucherValue') === 'number' ? { transportVoucherValue: document.get('transportVoucherValue') } : {}),
  }]));
  const prepared = await prepareScheduleRevision({ scheduleRef: state.ref, revisionId, identity,
    entries, people, references, candidates: people.map(({ userId }) => ({ userId, competence: `${year}-${String(month).padStart(2, '0')}` })) });
  await onPrepared?.();
  return await dbAdmin.runTransaction(async (tx) => {
    const schedule = await tx.get(state.ref);
    assertAccess(context, schedule, 'publish');
    if (draftVersion(schedule) !== expectedDraftVersion || draftGeneration(schedule) !== state.generation
      || publicationVersion(schedule) !== oldVersion || Number(schedule.get('operationalVersion') ?? 0) !== oldOperationalVersion
      || (schedule.get('activeRevisionId') ?? null) !== identity.baseRevisionId
      || Number(schedule.get('journeyValidationVersion') ?? 0) !== validation.version) {
      fail('DP_SCHEDULE_PUBLICATION_STALE', 'CONFLICT', 'A escala mudou durante a preparação. Revise e tente novamente.');
    }
    const [manifest, ...currentBasis] = await tx.getAll(state.ref.collection('revisions').doc(revisionId), ...basisRefs);
    if (!manifest.exists || manifest.get('status') !== 'ready' || manifest.get('hash') !== prepared.hash
      || manifest.get('scheduleId') !== scheduleId) fail('DP_REVISION_INCOMPLETE', 'DATA_INTEGRITY', 'A revisão preparada está incompleta.');
    if (currentBasis.some((document, index) => document.updateTime?.toMillis() !== basisTimes[index][1])) {
      fail('DP_SCHEDULE_PUBLICATION_BASIS_CHANGED', 'CONFLICT', 'Dados de unidade, pessoa ou jornada mudaram. Revise a escala.');
    }
    const fence = await preparePublicationFenceCommit(tx, workspaceId, fencePeople, capturedFence);
    const now = Timestamp.now();
    fence.apply();
    const version = oldVersion + 1;
    const draftedCoverage = schedule.get('draftCoverageDemands');
    tx.update(state.ref, { activeRevisionId: revisionId, publicationStatus: 'published', publicationVersion: version,
      ...(draftedCoverage !== undefined ? { coverageDemands: Object.keys(draftedCoverage ?? {}).length ? draftedCoverage : FieldValue.delete() } : {}),
      draftCoverageDemands: FieldValue.delete(),
      draftGenerationId: randomUUID(), draftVersion: 0, publishedAt: now, publishedBy: context.decoded.uid,
      shiftCount: entries.length, snapshot: { users: snapshotUsers },
      goalEligibilityVersion: FieldValue.increment(1), journeyValidationVersion: FieldValue.increment(1),
      journeyValidation: { status: validation.status, checkedAt: now, checkedBy: context.decoded.uid,
        version: validation.version, blockingIssueCount: 0 } });
    tx.create(dbAdmin.collection('dp_scheduleRevisionEvents').doc(`${scheduleId}_${version}`), {
      workspaceId, scheduleId, version, revisionId, unitId, year, month, status: 'pending',
      shiftCount: entries.length, changedShiftIds: changedIds, createdAt: now });
    tx.create(dbAdmin.collection('actionLogs').doc(), { workspace_id: workspaceId, user_id: context.decoded.uid,
      username: context.userDoc.username ?? null, module: 'dp.schedules', action: 'schedule_published',
      metadata: { request_id: requestId, schedule_id: scheduleId, version, revision_id: revisionId,
        changed_shift_count: changedIds.length }, ip_address: null, timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + 365 * 24 * 60 * 60 * 1000) });
    return { publicationStatus: 'published' as const, publicationVersion: version, shiftCount: entries.length, validation };
  });
  } finally {
    await releaseClosureFence();
  }
}

export async function publishSchedule(context: ServerUserContext, scheduleId: string, requestId: string, expectedDraftVersion: number) {
  return publishPreparedSchedule(context, scheduleId, requestId, expectedDraftVersion);
}
