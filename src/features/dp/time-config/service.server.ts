import 'server-only';

import { FieldValue, Timestamp, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { applicabilityOverlaps, applicabilityScopeCollection, applicabilitySpecificity, changedShiftBizneoIdentity, previousCalendarDate, validityOverlaps } from '@/lib/dp-time-config-rules';
import { AppError } from '@/lib/observability/app-error';
import { resolveUnitAccess } from '@/lib/unit-access';
import type { DPTimeApplicability } from '@/types';

import {
  completeJourneySchema,
  completeOvertimePolicySchema,
  completeShiftDefinitionSchema,
  type CreateJourneyInput,
  type CreateOvertimePolicyInput,
  type CreateShiftDefinitionInput,
  type UpdateJourneyInput,
  type UpdateOvertimePolicyInput,
  type UpdateShiftDefinitionInput,
} from './schemas';

const JOURNEYS = 'dp_journeys';
const OVERTIME_POLICIES = 'dp_overtimePolicies';
const SHIFT_DEFINITIONS = 'dp_shiftDefinitions';
const LIST_LIMIT = 100;
const SHIFT_LIST_LIMIT = 500;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type TimeConfigCollection = typeof JOURNEYS | typeof OVERTIME_POLICIES;
type CreateTimeConfigInput = CreateJourneyInput | CreateOvertimePolicyInput;
type UpdateTimeConfigInput = UpdateJourneyInput | UpdateOvertimePolicyInput;

function assertManageTime(context: ServerUserContext) {
  if (!context.isDefaultAdmin && context.permissions.dp.settings.manageTime !== true) {
    throw new AppError({ code: 'DP_TIME_CONFIG_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar jornadas e horas extras.' });
  }
  if (!resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin }).allUnits) {
    throw new AppError({ code: 'DP_TIME_GLOBAL_SCOPE_REQUIRED', kind: 'AUTHORIZATION', safeMessage: 'Configurações de tempo exigem acesso a todas as unidades.' });
  }
}

function assertManageShifts(context: ServerUserContext) {
  if (!context.isDefaultAdmin && context.permissions.dp.settings.manageShifts !== true) {
    throw new AppError({ code: 'DP_SHIFT_DEFINITION_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar turnos.' });
  }
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return ((value as { toDate(): Date }).toDate()).toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serializeValue(nested)]));
  }
  return value;
}

function serializeDocument(document: QueryDocumentSnapshot) {
  return { id: document.id, ...(serializeValue(document.data()) as Record<string, unknown>) };
}

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)))].sort()
    : [];
}

function auditPayload(context: ServerUserContext, params: {
  module: string;
  action: string;
  requestId: string;
  metadata: Record<string, unknown>;
}, now: Timestamp) {
  return {
    workspace_id: context.workspace_id,
    user_id: context.decoded.uid,
    username: context.userDoc.username ?? null,
    module: params.module,
    action: params.action,
    metadata: { request_id: params.requestId, ...params.metadata },
    ip_address: null,
    timestamp: now,
    ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
  };
}

function collectionLabel(collectionName: TimeConfigCollection) {
  return collectionName === JOURNEYS ? 'jornada' : 'política de hora extra';
}

function parseComplete(collectionName: TimeConfigCollection, value: unknown) {
  const editable = timeConfigEditableFields(collectionName, value as Record<string, unknown>);
  return collectionName === JOURNEYS
    ? completeJourneySchema.safeParse(editable)
    : completeOvertimePolicySchema.safeParse(editable);
}

const JOURNEY_FIELDS = ['name', 'description', 'weeklyMinutes', 'cycleLengthDays', 'days', 'regime', 'weeklyRest', 'scaleValidation', 'expectedBreakMinutes', 'useDefinedShiftWhenShorter', 'toleranceMinutes', 'allowedShiftDefinitionIds', 'applicability', 'validFrom', 'validTo'] as const;
const OVERTIME_FIELDS = ['name', 'description', 'collectiveAgreementReference', 'applicability', 'validFrom', 'validTo', 'dailyOvertimeLimitMinutes', 'weeklyOvertimeLimitMinutes', 'categories', 'timeBank', 'externalCoverageRule'] as const;
const SHIFT_FIELDS = ['code', 'name', 'startTime', 'endTime', 'breakStart', 'breakEnd', 'breakType', 'breakDurationMinutes', 'breakWindowStart', 'breakWindowEnd', 'breakSegments', 'breakSplit', 'breakPauseCount', 'breakMinPauseMinutes', 'unitId', 'unitName', 'unitIds', 'unitNames', 'daysOfWeek', 'bizneoTemplateId', 'journeyIds', 'description', 'configurationNotes', 'overnight', 'expectedPunches', 'executionUnitPolicy', 'isArchived'] as const;

function pickFields(source: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.flatMap((field) => field in source ? [[field, source[field]]] : []));
}

function timeConfigEditableFields(collectionName: TimeConfigCollection, source: Record<string, unknown>) {
  return pickFields(source, collectionName === JOURNEYS ? JOURNEY_FIELDS : OVERTIME_FIELDS);
}

async function validateApplicabilityReferences(applicability: DPTimeApplicability) {
  const scope = applicability.scope;
  const collectionName = applicabilityScopeCollection(scope);
  if (collectionName && 'id' in scope) {
    const snapshot = await dbAdmin.collection(collectionName).doc(scope.id).get();
    if (!snapshot.exists || snapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_TIME_SCOPE_INVALID', kind: 'VALIDATION', safeMessage: 'A abrangência selecionada não existe ou está arquivada.' });
    }
  }

  const collaboratorIds = normalizeIds(applicability.collaboratorIds);
  if (collaboratorIds.length) {
    const collaborators = await dbAdmin.getAll(...collaboratorIds.map((id) => dbAdmin.collection('users').doc(id)));
    if (collaborators.some((snapshot) => !snapshot.exists || snapshot.get('isActive') === false)) {
      throw new AppError({ code: 'DP_TIME_COLLABORATOR_INVALID', kind: 'VALIDATION', safeMessage: 'Uma das pessoas selecionadas não existe ou está inativa.' });
    }
  }
}

async function validateJourneyShiftReferences(input: Record<string, unknown>) {
  const shiftIds = normalizeIds(input.allowedShiftDefinitionIds);
  if (!shiftIds.length) return;
  const shifts = await dbAdmin.getAll(...shiftIds.map((id) => dbAdmin.collection(SHIFT_DEFINITIONS).doc(id)));
  if (shifts.some((snapshot) => !snapshot.exists || snapshot.get('isArchived') === true)) {
    throw new AppError({ code: 'DP_JOURNEY_SHIFT_INVALID', kind: 'VALIDATION', safeMessage: 'Um dos turnos permitidos não existe ou está arquivado.' });
  }
}

async function validateJourneyShiftReferencesInTransaction(transaction: Transaction, input: Record<string, unknown>) {
  const shiftIds = normalizeIds(input.allowedShiftDefinitionIds);
  if (!shiftIds.length) return;
  const shifts = await transaction.getAll(...shiftIds.map((id) => dbAdmin.collection(SHIFT_DEFINITIONS).doc(id)));
  if (shifts.some((snapshot) => !snapshot.exists || snapshot.get('isArchived') === true)) {
    throw new AppError({ code: 'DP_JOURNEY_SHIFT_INVALID', kind: 'VALIDATION', safeMessage: 'Um dos turnos permitidos não existe ou está arquivado.' });
  }
}

async function validateTimeConfigReferences(collectionName: TimeConfigCollection, input: Record<string, unknown>) {
  await validateApplicabilityReferences(input.applicability as DPTimeApplicability);
  if (collectionName === JOURNEYS) await validateJourneyShiftReferences(input);
}

export async function listTimeConfigs(context: ServerUserContext, collectionName: TimeConfigCollection) {
  assertManageTime(context);
  const snapshot = await dbAdmin.collection(collectionName).orderBy('updatedAt', 'desc').limit(LIST_LIMIT + 1).get();
  if (snapshot.size > LIST_LIMIT) {
    throw new AppError({ code: 'DP_TIME_CONFIG_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há configurações demais para carregar com segurança.' });
  }
  return snapshot.docs.map(serializeDocument);
}

export async function getTimeConfig(context: ServerUserContext, collectionName: TimeConfigCollection, id: string) {
  assertManageTime(context);
  const snapshot = await dbAdmin.collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new AppError({ code: 'DP_TIME_CONFIG_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: `${collectionLabel(collectionName)} não encontrada.` });
  return { id: snapshot.id, ...(serializeValue(snapshot.data()) as Record<string, unknown>) };
}

export async function createTimeConfig(params: {
  context: ServerUserContext;
  collectionName: TimeConfigCollection;
  input: CreateTimeConfigInput;
  requestId: string;
}) {
  const { context, collectionName, input, requestId } = params;
  assertManageTime(context);
  const { supersedesId, ...fields } = input;
  await validateTimeConfigReferences(collectionName, fields as Record<string, unknown>);
  const ref = dbAdmin.collection(collectionName).doc();
  const parentRef = supersedesId ? dbAdmin.collection(collectionName).doc(supersedesId) : null;

  await dbAdmin.runTransaction(async (transaction) => {
    const parent = parentRef ? await transaction.get(parentRef) : null;
    if (parentRef && (!parent?.exists || !['published', 'archived'].includes(String(parent.get('status'))))) {
      throw new AppError({ code: 'DP_TIME_SUPERSEDED_CONFIG_INVALID', kind: 'CONFLICT', safeMessage: 'A versão anterior não está disponível para revisão.' });
    }
    if (collectionName === JOURNEYS) {
      await validateJourneyShiftReferencesInTransaction(transaction, fields as Record<string, unknown>);
    }
    const now = Timestamp.now();
    const version = parent ? Number(parent.get('version') ?? 1) + 1 : 1;
    const lineageId = parent ? String(parent.get('lineageId') ?? parent.id) : ref.id;
    transaction.create(ref, {
      ...fields,
      status: 'draft',
      version,
      lineageId,
      ...(supersedesId ? { supersedesId } : {}),
      createdAt: now,
      createdBy: context.decoded.uid,
      updatedAt: now,
      updatedBy: context.decoded.uid,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, {
      module: 'dp.time', action: `${collectionName}_created`, requestId,
      metadata: { config_id: ref.id, version, supersedes_id: supersedesId ?? null },
    }, now));
  });
  return getTimeConfig(context, collectionName, ref.id);
}

export async function updateTimeConfig(params: {
  context: ServerUserContext;
  collectionName: TimeConfigCollection;
  id: string;
  input: UpdateTimeConfigInput;
  requestId: string;
}) {
  const { context, collectionName, id, input, requestId } = params;
  assertManageTime(context);
  const ref = dbAdmin.collection(collectionName).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new AppError({ code: 'DP_TIME_CONFIG_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: `${collectionLabel(collectionName)} não encontrada.` });
  const current = existing.data() ?? {};

  let nextFields: Record<string, unknown> | null = null;
  if (input.action === 'update') {
    if (current.status !== 'draft') throw new AppError({ code: 'DP_TIME_CONFIG_IMMUTABLE', kind: 'CONFLICT', safeMessage: 'Configuração publicada não pode ser editada. Crie uma nova versão.' });
    const merged = { ...timeConfigEditableFields(collectionName, current) };
    for (const [field, value] of Object.entries(input.data)) {
      if (value === null) delete merged[field];
      else merged[field] = value;
    }
    const parsed = parseComplete(collectionName, merged);
    if (!parsed.success) throw new AppError({ code: 'DP_TIME_CONFIG_UPDATE_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Configuração inválida.' });
    nextFields = parsed.data as unknown as Record<string, unknown>;
    await validateTimeConfigReferences(collectionName, nextFields);
  } else if (input.action === 'publish') {
    if (current.status !== 'draft') throw new AppError({ code: 'DP_TIME_CONFIG_NOT_DRAFT', kind: 'CONFLICT', safeMessage: 'Somente rascunhos podem ser publicados.' });
    const parsed = parseComplete(collectionName, current);
    if (!parsed.success) throw new AppError({ code: 'DP_TIME_CONFIG_PUBLISH_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Complete a configuração antes de publicar.' });
    await validateTimeConfigReferences(collectionName, parsed.data as unknown as Record<string, unknown>);
  } else if (current.status === 'archived') {
    throw new AppError({ code: 'DP_TIME_CONFIG_ALREADY_ARCHIVED', kind: 'CONFLICT', safeMessage: 'A configuração já está arquivada.' });
  }

  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    if (!fresh.exists || fresh.get('status') !== current.status || fresh.get('updatedAt')?.toMillis?.() !== existing.get('updatedAt')?.toMillis?.()) {
      throw new AppError({ code: 'DP_TIME_CONFIG_CHANGED', kind: 'CONFLICT', safeMessage: 'A configuração foi alterada. Atualize a página e tente novamente.' });
    }
    if (collectionName === JOURNEYS) {
      const journeyFields = input.action === 'update' && nextFields ? nextFields : fresh.data();
      await validateJourneyShiftReferencesInTransaction(transaction, journeyFields as Record<string, unknown>);
    }
    const now = Timestamp.now();
    if (input.action === 'update' && nextFields) {
      const removedOptionalFields = Object.fromEntries(
        (collectionName === JOURNEYS ? JOURNEY_FIELDS : OVERTIME_FIELDS)
          .filter((field) => field in current && !(field in nextFields!))
          .map((field) => [field, FieldValue.delete()]),
      );
      transaction.update(ref, { ...removedOptionalFields, ...nextFields, updatedAt: now, updatedBy: context.decoded.uid });
    } else if (input.action === 'publish') {
      const published = await transaction.get(dbAdmin.collection(collectionName).where('status', '==', 'published').limit(LIST_LIMIT + 1));
      if (published.size > LIST_LIMIT) {
        throw new AppError({ code: 'DP_TIME_PUBLISHED_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há configurações publicadas demais para validar a vigência.' });
      }
      const conflicts = published.docs.filter((candidate) => candidate.id !== id
        && candidate.id !== fresh.get('supersedesId')
        && applicabilityOverlaps(candidate.get('applicability') as DPTimeApplicability, fresh.get('applicability') as DPTimeApplicability)
        && applicabilitySpecificity(candidate.get('applicability') as DPTimeApplicability).score
          === applicabilitySpecificity(fresh.get('applicability') as DPTimeApplicability).score
        && validityOverlaps(candidate.data() as { validFrom: string; validTo?: string }, fresh.data() as { validFrom: string; validTo?: string }));
      if (conflicts.length) {
        throw new AppError({ code: 'DP_TIME_CONFIG_AMBIGUOUS_OVERLAP', kind: 'CONFLICT', safeMessage: 'Já existe uma configuração publicada com a mesma abrangência e vigência sobreposta.' });
      }
      const supersedesId = fresh.get('supersedesId');
      if (typeof supersedesId === 'string' && supersedesId) {
        const previousRef = dbAdmin.collection(collectionName).doc(supersedesId);
        const previous = await transaction.get(previousRef);
        if (!previous.exists || previous.get('status') !== 'published') {
          throw new AppError({ code: 'DP_TIME_PREVIOUS_VERSION_CHANGED', kind: 'CONFLICT', safeMessage: 'A versão anterior mudou. Atualize a página e tente novamente.' });
        }
        const previousValidFrom = String(previous.get('validFrom') ?? '');
        const nextValidFrom = String(fresh.get('validFrom') ?? '');
        if (!previousValidFrom || nextValidFrom <= previousValidFrom) {
          throw new AppError({
            code: 'DP_TIME_SUCCESSOR_VALIDITY_INVALID',
            kind: 'VALIDATION',
            safeMessage: 'A nova versão deve iniciar depois do início da versão anterior.',
          });
        }
        const closingDate = previousCalendarDate(nextValidFrom);
        if (!closingDate) {
          throw new AppError({ code: 'DP_TIME_SUCCESSOR_VALIDITY_INVALID', kind: 'VALIDATION', safeMessage: 'Revise o início da vigência da nova versão.' });
        }
        const previousValidTo = typeof previous.get('validTo') === 'string' ? String(previous.get('validTo')) : null;
        transaction.update(previousRef, {
          status: 'archived',
          ...(!previousValidTo || previousValidTo >= nextValidFrom ? { validTo: closingDate } : {}),
          archivedAt: now,
          archivedBy: context.decoded.uid,
          updatedAt: now,
          updatedBy: context.decoded.uid,
        });
      }
      transaction.update(ref, { status: 'published', publishedAt: now, publishedBy: context.decoded.uid, updatedAt: now, updatedBy: context.decoded.uid });
    } else {
      transaction.update(ref, { status: 'archived', archivedAt: now, archivedBy: context.decoded.uid, updatedAt: now, updatedBy: context.decoded.uid });
    }
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, {
      module: 'dp.time', action: `${collectionName}_${input.action}`, requestId,
      metadata: { config_id: id, version: fresh.get('version') ?? null },
    }, now));
  });
  return getTimeConfig(context, collectionName, id);
}

export async function deleteTimeConfig(params: {
  context: ServerUserContext;
  collectionName: TimeConfigCollection;
  id: string;
  requestId: string;
}) {
  const { context, collectionName, id, requestId } = params;
  assertManageTime(context);
  const ref = dbAdmin.collection(collectionName).doc(id);
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new AppError({ code: 'DP_TIME_CONFIG_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: `${collectionLabel(collectionName)} não encontrada.` });
    if (snapshot.get('status') !== 'draft') throw new AppError({ code: 'DP_TIME_CONFIG_DELETE_FORBIDDEN', kind: 'CONFLICT', safeMessage: 'Somente rascunhos podem ser excluídos.' });
    const now = Timestamp.now();
    transaction.delete(ref);
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, {
      module: 'dp.time', action: `${collectionName}_deleted`, requestId,
      metadata: { config_id: id, version: snapshot.get('version') ?? null },
    }, now));
  });
}

function cleanNullableFields(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) result[key] = value === null ? FieldValue.delete() : value;
  return result;
}

function omitNullableFields(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined));
}

async function validateLinkedJourneysInTransaction(
  transaction: Transaction,
  journeyIds: unknown,
  options: { preservedArchivedIds?: Set<string> } = {},
) {
  const ids = normalizeIds(journeyIds);
  if (!ids.length) return;
  const snapshots = await transaction.getAll(...ids.map((id) => dbAdmin.collection(JOURNEYS).doc(id)));
  if (snapshots.some((snapshot) => !snapshot.exists || (
    snapshot.get('status') !== 'published'
    && !(snapshot.get('status') === 'archived' && options.preservedArchivedIds?.has(snapshot.id))
  ))) {
    throw new AppError({ code: 'DP_SHIFT_JOURNEY_INVALID', kind: 'VALIDATION', safeMessage: 'Vincule o turno somente a jornadas publicadas.' });
  }
}

export async function listShiftDefinitions(context: ServerUserContext) {
  assertManageShifts(context);
  const snapshot = await dbAdmin.collection(SHIFT_DEFINITIONS).orderBy('name').limit(SHIFT_LIST_LIMIT + 1).get();
  if (snapshot.size > SHIFT_LIST_LIMIT) throw new AppError({ code: 'DP_SHIFT_DEFINITION_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há turnos demais para carregar com segurança.' });
  return snapshot.docs.map(serializeDocument);
}

export async function getShiftDefinition(context: ServerUserContext, id: string) {
  assertManageShifts(context);
  const snapshot = await dbAdmin.collection(SHIFT_DEFINITIONS).doc(id).get();
  if (!snapshot.exists) throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Turno não encontrado.' });
  return { id: snapshot.id, ...(serializeValue(snapshot.data()) as Record<string, unknown>) };
}

export async function createShiftDefinition(params: { context: ServerUserContext; input: CreateShiftDefinitionInput; requestId: string }) {
  const { context, input, requestId } = params;
  assertManageShifts(context);
  if (normalizeIds(input.journeyIds).length) assertManageTime(context);
  const ref = dbAdmin.collection(SHIFT_DEFINITIONS).doc();
  await dbAdmin.runTransaction(async (transaction) => {
    const duplicate = await transaction.get(dbAdmin.collection(SHIFT_DEFINITIONS).where('code', '==', input.code).limit(1));
    if (!duplicate.empty) throw new AppError({ code: 'DP_SHIFT_CODE_DUPLICATE', kind: 'CONFLICT', safeMessage: 'Já existe um turno com este código.' });
    await validateLinkedJourneysInTransaction(transaction, input.journeyIds);
    const now = Timestamp.now();
    transaction.create(ref, { ...omitNullableFields(input), isArchived: false, createdAt: now, updatedAt: now, updatedBy: context.decoded.uid });
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, {
      module: 'dp.time.shifts', action: 'shift_definition_created', requestId,
      metadata: { shift_definition_id: ref.id, code: input.code },
    }, now));
  });
  return getShiftDefinition(context, ref.id);
}

export async function updateShiftDefinition(params: { context: ServerUserContext; id: string; input: UpdateShiftDefinitionInput; requestId: string }) {
  const { context, id, input, requestId } = params;
  assertManageShifts(context);
  const ref = dbAdmin.collection(SHIFT_DEFINITIONS).doc(id);

  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    if (!fresh.exists) throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Turno não encontrado.' });
    const freshData = fresh.data() ?? {};
    const archiveTransition = Object.hasOwn(input, 'isArchived');
    if (archiveTransition && Object.keys(input).length !== 1) {
      throw new AppError({ code: 'DP_SHIFT_ARCHIVE_TRANSITION_INVALID', kind: 'VALIDATION', safeMessage: 'Arquive ou reative o turno em uma ação separada.' });
    }
    if (freshData.isArchived === true && input.isArchived !== false) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_ARCHIVED', kind: 'CONFLICT', safeMessage: 'Reative o turno antes de editá-lo.' });
    }
    const currentJourneyIds = normalizeIds(freshData.journeyIds);
    const nextJourneyIds = Object.hasOwn(input, 'journeyIds') ? normalizeIds(input.journeyIds) : currentJourneyIds;
    const journeyLinksChanged = currentJourneyIds.length !== nextJourneyIds.length
      || currentJourneyIds.some((journeyId, index) => journeyId !== nextJourneyIds[index]);
    if (journeyLinksChanged) assertManageTime(context);
    const changedBizneoFields = changedShiftBizneoIdentity(freshData, input as Record<string, unknown>);
    if (changedBizneoFields.length) {
      throw new AppError({
        code: 'DP_SHIFT_BIZNEO_IDENTITY_IMMUTABLE',
        kind: 'CONFLICT',
        safeMessage: 'Nome, código e ID Bizneo do turno existente devem ser preservados durante a migração.',
      });
    }
    const merged = { ...pickFields(freshData, SHIFT_FIELDS), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)) };
    for (const [key, value] of Object.entries(input)) if (value === null) delete merged[key];
    const parsed = completeShiftDefinitionSchema.safeParse(merged);
    if (!parsed.success) throw new AppError({ code: 'DP_SHIFT_DEFINITION_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Configuração do turno inválida.' });
    // Arquivar precisa continuar possível mesmo quando o turno conserva vínculos
    // puramente históricos com jornadas que já foram removidas. As referências
    // voltam a ser validadas ao reativar ou editar o cadastro.
    if (input.isArchived !== true) {
      await validateLinkedJourneysInTransaction(transaction, parsed.data.journeyIds, {
        preservedArchivedIds: new Set(currentJourneyIds),
      });
    }
    const now = Timestamp.now();
    const isArchiving = input.isArchived === true && freshData.isArchived !== true;
    const isReactivating = input.isArchived === false && freshData.isArchived === true;
    transaction.update(ref, {
      ...cleanNullableFields(input),
      ...(isArchiving ? { archivedAt: now, archivedBy: context.decoded.uid } : {}),
      ...(isReactivating ? { archivedAt: FieldValue.delete(), archivedBy: FieldValue.delete() } : {}),
      updatedAt: now,
      updatedBy: context.decoded.uid,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, {
      module: 'dp.time.shifts',
      action: isArchiving ? 'shift_definition_archived' : isReactivating ? 'shift_definition_reactivated' : 'shift_definition_updated',
      requestId,
      metadata: { shift_definition_id: id, changed_fields: Object.keys(input).sort() },
    }, now));
  });
  return getShiftDefinition(context, id);
}

export async function deleteShiftDefinition(params: { context: ServerUserContext; id: string; requestId: string }) {
  const { context, id, requestId } = params;
  assertManageShifts(context);
  const ref = dbAdmin.collection(SHIFT_DEFINITIONS).doc(id);
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Turno não encontrado.' });
    const linkedJourneys = await transaction.get(
      dbAdmin.collection(JOURNEYS).where('allowedShiftDefinitionIds', 'array-contains', id).limit(1),
    );
    if (!linkedJourneys.empty) {
      throw new AppError({
        code: 'DP_SHIFT_DEFINITION_IN_USE',
        kind: 'CONFLICT',
        safeMessage: 'Remova o turno das jornadas vinculadas antes de excluí-lo.',
      });
    }
    if (snapshot.get('isArchived') !== true) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_DELETE_REQUIRES_ARCHIVE', kind: 'CONFLICT', safeMessage: 'Arquive o turno antes de excluí-lo definitivamente.' });
    }
    const now = Timestamp.now();
    transaction.delete(ref);
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, {
      module: 'dp.time.shifts', action: 'shift_definition_deleted', requestId,
      metadata: { shift_definition_id: id, code: snapshot.get('code') ?? null },
    }, now));
  });
}

export const DP_TIME_COLLECTIONS = { journeys: JOURNEYS, overtimePolicies: OVERTIME_POLICIES } as const;
