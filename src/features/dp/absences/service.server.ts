import 'server-only';

import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';

import type { CreateAbsenceTypeInput, UpdateAbsenceTypeInput } from '@/features/dp/absences/schemas';
import { completeAbsenceTypeSchema } from '@/features/dp/absences/schemas';
import type { ServerUserContext } from '@/lib/auth-server';
import { applicabilityScopeCollection, previousCalendarDate } from '@/lib/dp-time-config-rules';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { DPAbsencePolicy, DPTimeApplicability } from '@/types';

const COLLECTION = 'dp_absenceTypes';
const LIST_LIMIT = 100;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const EDITABLE_FIELDS = [
  'name', 'description', 'color', 'requestUnits', 'initiatedBy', 'workdayEffect',
  'includeInAbsenteeism', 'blocksSchedule', 'policies', 'validFrom', 'validTo',
] as const;

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serializeValue(nested)]));
  }
  return value;
}

function serializeDocument(document: DocumentSnapshot) {
  return { id: document.id, ...(serializeValue(document.data()) as Record<string, unknown>) };
}

function editableFields(source: Record<string, unknown>) {
  return Object.fromEntries(EDITABLE_FIELDS.flatMap((field) => field in source ? [[field, source[field]]] : []));
}

function auditPayload(context: ServerUserContext, action: string, requestId: string, metadata: Record<string, unknown>, now: Timestamp) {
  return {
    workspace_id: context.workspace_id,
    user_id: context.decoded.uid,
    username: context.userDoc.username ?? null,
    module: 'dp.absences',
    action,
    metadata: { request_id: requestId, ...metadata },
    ip_address: null,
    timestamp: now,
    ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
  };
}

async function validateApplicabilityReferences(policies: DPAbsencePolicy[]) {
  const scopeReferences = new Map<string, { collection: string; id: string }>();
  const collaboratorIds = new Set<string>();
  for (const policy of policies) {
    const applicability = policy.applicability as DPTimeApplicability;
    const collection = applicabilityScopeCollection(applicability.scope);
    if (collection && 'id' in applicability.scope) {
      scopeReferences.set(`${collection}/${applicability.scope.id}`, { collection, id: applicability.scope.id });
    }
    for (const id of applicability.collaboratorIds ?? []) collaboratorIds.add(id);
  }

  const references = [
    ...[...scopeReferences.values()].map(({ collection, id }) => dbAdmin.collection(collection).doc(id)),
    ...[...collaboratorIds].map((id) => dbAdmin.collection('users').doc(id)),
  ];
  for (let index = 0; index < references.length; index += 100) {
    const snapshots = await dbAdmin.getAll(...references.slice(index, index + 100));
    if (snapshots.some((snapshot) => !snapshot.exists || snapshot.get('isArchived') === true || snapshot.get('isActive') === false)) {
      throw new AppError({
        code: 'DP_ABSENCE_REFERENCE_INVALID',
        kind: 'VALIDATION',
        safeMessage: 'Uma abrangência ou pessoa selecionada não existe, está arquivada ou inativa.',
      });
    }
  }
}

function parseComplete(source: Record<string, unknown>) {
  return completeAbsenceTypeSchema.safeParse(editableFields(source));
}

export async function listAbsenceTypes() {
  const snapshot = await dbAdmin.collection(COLLECTION).orderBy('updatedAt', 'desc').limit(LIST_LIMIT + 1).get();
  if (snapshot.size > LIST_LIMIT) {
    throw new AppError({ code: 'DP_ABSENCE_LIST_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'Há tipos de ausência demais para carregar de uma vez.' });
  }
  return snapshot.docs.map(serializeDocument);
}

export async function getAbsenceType(id: string) {
  const snapshot = await dbAdmin.collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new AppError({ code: 'DP_ABSENCE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Tipo de ausência não encontrado.' });
  return serializeDocument(snapshot);
}

export async function createAbsenceType(params: {
  context: ServerUserContext;
  input: CreateAbsenceTypeInput;
  requestId: string;
}) {
  const { context, input, requestId } = params;
  const { supersedesId, ...fields } = input;
  await validateApplicabilityReferences(fields.policies as DPAbsencePolicy[]);
  const ref = dbAdmin.collection(COLLECTION).doc();
  const parentRef = supersedesId ? dbAdmin.collection(COLLECTION).doc(supersedesId) : null;
  await dbAdmin.runTransaction(async (transaction) => {
    const parent = parentRef ? await transaction.get(parentRef) : null;
    if (parentRef && (!parent?.exists || !['published', 'archived'].includes(String(parent.get('status'))))) {
      throw new AppError({ code: 'DP_ABSENCE_SUPERSEDED_INVALID', kind: 'CONFLICT', safeMessage: 'A versão anterior não está disponível para revisão.' });
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
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, 'absence_type_created', requestId, {
      absence_type_id: ref.id, version, supersedes_id: supersedesId ?? null,
    }, now));
  });
  return getAbsenceType(ref.id);
}

export async function updateAbsenceType(params: {
  context: ServerUserContext;
  id: string;
  input: UpdateAbsenceTypeInput;
  requestId: string;
}) {
  const { context, id, input, requestId } = params;
  const ref = dbAdmin.collection(COLLECTION).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new AppError({ code: 'DP_ABSENCE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Tipo de ausência não encontrado.' });
  const current = existing.data() ?? {};

  let nextFields: Record<string, unknown> | null = null;
  if (input.action === 'update') {
    if (current.status !== 'draft') throw new AppError({ code: 'DP_ABSENCE_IMMUTABLE', kind: 'CONFLICT', safeMessage: 'Tipo publicado não pode ser editado. Crie uma nova versão.' });
    const merged = editableFields(current);
    for (const [field, value] of Object.entries(input.data)) {
      if (value === null) delete merged[field];
      else merged[field] = value;
    }
    const parsed = parseComplete(merged);
    if (!parsed.success) throw new AppError({ code: 'DP_ABSENCE_UPDATE_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Configuração inválida.' });
    nextFields = parsed.data as unknown as Record<string, unknown>;
    await validateApplicabilityReferences(parsed.data.policies as DPAbsencePolicy[]);
  } else if (input.action === 'publish') {
    if (current.status !== 'draft') throw new AppError({ code: 'DP_ABSENCE_NOT_DRAFT', kind: 'CONFLICT', safeMessage: 'Somente rascunhos podem ser publicados.' });
    const parsed = parseComplete(current);
    if (!parsed.success) throw new AppError({ code: 'DP_ABSENCE_PUBLISH_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Complete a configuração antes de publicar.' });
    await validateApplicabilityReferences(parsed.data.policies as DPAbsencePolicy[]);
  } else if (current.status === 'archived') {
    throw new AppError({ code: 'DP_ABSENCE_ALREADY_ARCHIVED', kind: 'CONFLICT', safeMessage: 'O tipo já está arquivado.' });
  }

  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    if (!fresh.exists || fresh.get('status') !== current.status || fresh.get('updatedAt')?.toMillis?.() !== existing.get('updatedAt')?.toMillis?.()) {
      throw new AppError({ code: 'DP_ABSENCE_CHANGED', kind: 'CONFLICT', safeMessage: 'A configuração foi alterada. Atualize a página e tente novamente.' });
    }
    const now = Timestamp.now();
    if (input.action === 'update' && nextFields) {
      const removed = Object.fromEntries(EDITABLE_FIELDS.filter((field) => field in current && !(field in nextFields!)).map((field) => [field, FieldValue.delete()]));
      transaction.update(ref, { ...removed, ...nextFields, updatedAt: now, updatedBy: context.decoded.uid });
    } else if (input.action === 'publish') {
      const supersedesId = fresh.get('supersedesId');
      if (typeof supersedesId === 'string' && supersedesId) {
        const previousRef = dbAdmin.collection(COLLECTION).doc(supersedesId);
        const previous = await transaction.get(previousRef);
        if (!previous.exists || previous.get('status') !== 'published') {
          throw new AppError({ code: 'DP_ABSENCE_PREVIOUS_CHANGED', kind: 'CONFLICT', safeMessage: 'A versão anterior mudou. Atualize a página e tente novamente.' });
        }
        const previousValidFrom = String(previous.get('validFrom') ?? '');
        const nextValidFrom = String(fresh.get('validFrom') ?? '');
        if (!previousValidFrom || nextValidFrom <= previousValidFrom) {
          throw new AppError({ code: 'DP_ABSENCE_SUCCESSOR_INVALID', kind: 'VALIDATION', safeMessage: 'A nova versão deve iniciar depois do início da versão anterior.' });
        }
        const closingDate = previousCalendarDate(nextValidFrom);
        if (!closingDate) throw new AppError({ code: 'DP_ABSENCE_SUCCESSOR_INVALID', kind: 'VALIDATION', safeMessage: 'Revise o início da vigência.' });
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
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, `absence_type_${input.action}`, requestId, {
      absence_type_id: id, version: fresh.get('version') ?? null,
    }, now));
  });
  return getAbsenceType(id);
}

export async function deleteAbsenceType(params: { context: ServerUserContext; id: string; requestId: string }) {
  const { context, id, requestId } = params;
  const ref = dbAdmin.collection(COLLECTION).doc(id);
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new AppError({ code: 'DP_ABSENCE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Tipo de ausência não encontrado.' });
    if (snapshot.get('status') !== 'draft') throw new AppError({ code: 'DP_ABSENCE_DELETE_FORBIDDEN', kind: 'CONFLICT', safeMessage: 'Somente rascunhos podem ser excluídos.' });
    const now = Timestamp.now();
    transaction.delete(ref);
    transaction.set(dbAdmin.collection('actionLogs').doc(), auditPayload(context, 'absence_type_deleted', requestId, {
      absence_type_id: id, version: snapshot.get('version') ?? null,
    }, now));
  });
}
