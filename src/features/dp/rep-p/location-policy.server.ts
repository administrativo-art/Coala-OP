import 'server-only';

import { createHash } from 'node:crypto';

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { canAccessUnit } from '@/lib/unit-access';
import { AppError } from '@/lib/observability/app-error';

import { REP_P_LOCATION_RETENTION_DAYS, type RepPLocationPolicySnapshot } from './location';

export const REP_P_LOCATION_POLICIES = 'repP_locationPolicies';
export const REP_P_LOCATION_EVIDENCE = 'repP_locationEvidence';
export const REP_P_LOCATION_REVIEWS = 'repP_locationReviews';

const centerSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

const repPLocationPolicyFieldsSchema = z.object({
  mode: z.enum(['disabled', 'observe']),
  center: centerSchema.nullable(),
  radiusMeters: z.number().int().min(25).max(10_000).nullable(),
  maxAccuracyMeters: z.number().int().min(5).max(5_000).nullable(),
  maxAgeSeconds: z.number().int().min(5).max(300).nullable(),
  captureTimeoutMs: z.number().int().min(2_000).max(30_000).nullable(),
  privacyNoticeUrl: z.string().url().max(500).refine((value) => value.startsWith('https://'), 'O aviso precisa usar HTTPS.').nullable(),
  legalBasisReference: z.string().trim().min(10).max(500).nullable(),
  retentionDays: z.literal(REP_P_LOCATION_RETENTION_DAYS).nullable(),
  participantUserIds: z.array(z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/)).max(20),
}).strict();

export const repPLocationPolicyInputSchema = repPLocationPolicyFieldsSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  activationConfirmation: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.participantUserIds).size !== value.participantUserIds.length) {
    context.addIssue({ code: 'custom', path: ['participantUserIds'], message: 'A lista do piloto contém pessoa repetida.' });
  }
  if (value.mode === 'disabled') return;
  for (const field of ['center', 'radiusMeters', 'maxAccuracyMeters', 'maxAgeSeconds', 'captureTimeoutMs',
    'legalBasisReference', 'retentionDays'] as const) {
    if (value[field] === null) context.addIssue({ code: 'custom', path: [field], message: 'Campo obrigatório para ativar a coleta.' });
  }
  if (!value.participantUserIds.length) context.addIssue({ code: 'custom', path: ['participantUserIds'],
    message: 'Escolha ao menos um participante do piloto.' });
  if (!value.activationConfirmation) context.addIssue({ code: 'custom', path: ['activationConfirmation'],
    message: 'Confirme a ativação da coleta nesta unidade.' });
});
export type RepPLocationPolicyInput = z.infer<typeof repPLocationPolicyInputSchema>;

type Dependencies = Readonly<{ mainDb: Firestore; repDb: Firestore; now: () => Date }>;
const defaults: Dependencies = { mainDb: dbAdmin, repDb: repPDbAdmin, now: () => new Date() };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'DATA_INTEGRITY' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}

export function repPLocationPolicyId(workspaceId: string, executionUnitId: string) {
  return createHash('sha256').update(JSON.stringify(['rep-p-location-policy', workspaceId, executionUnitId])).digest('hex');
}

export function repPLocationPolicyRef(repDb: Firestore, workspaceId: string, executionUnitId: string): DocumentReference {
  return repDb.collection(REP_P_LOCATION_POLICIES).doc(repPLocationPolicyId(workspaceId, executionUnitId));
}

export function disabledRepPLocationPolicy(workspaceId: string, executionUnitId: string): RepPLocationPolicySnapshot {
  return {
    schemaVersion: 1, workspaceId, executionUnitId, revision: 0, mode: 'disabled', center: null,
    radiusMeters: null, maxAccuracyMeters: null, maxAgeSeconds: null, captureTimeoutMs: null,
    privacyNoticeUrl: null, legalBasisReference: null, retentionDays: null, activatedAt: null, activatedBy: null,
    participantUserIds: [],
  };
}

function iso(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function parseRepPLocationPolicy(value: unknown, workspaceId: string, executionUnitId: string): RepPLocationPolicySnapshot {
  if (!value || typeof value !== 'object') return disabledRepPLocationPolicy(workspaceId, executionUnitId);
  const raw = value as Record<string, unknown>;
  const parsed = repPLocationPolicyFieldsSchema.safeParse({
    mode: raw.mode, center: raw.center ?? null, radiusMeters: raw.radiusMeters ?? null,
    maxAccuracyMeters: raw.maxAccuracyMeters ?? null, maxAgeSeconds: raw.maxAgeSeconds ?? null,
    captureTimeoutMs: raw.captureTimeoutMs ?? null, privacyNoticeUrl: raw.privacyNoticeUrl ?? null,
    legalBasisReference: raw.legalBasisReference ?? null, retentionDays: raw.retentionDays ?? null,
    participantUserIds: raw.participantUserIds ?? [],
  });
  const revision = Number(raw.revision);
  if (!parsed.success || raw.schemaVersion !== 1 || raw.workspaceId !== workspaceId || raw.executionUnitId !== executionUnitId
    || !Number.isSafeInteger(revision) || revision < 1) {
    throw fail('DP_TIME_LOCATION_POLICY_INVALID', 'A política de localização da unidade está inconsistente.', 'DATA_INTEGRITY');
  }
  return { schemaVersion: 1, workspaceId, executionUnitId, revision, ...parsed.data,
    activatedAt: parsed.data.mode === 'disabled' ? null : iso(raw.activatedAt),
    activatedBy: parsed.data.mode === 'disabled' ? null : typeof raw.activatedBy === 'string' ? raw.activatedBy : null };
}

/** A localização é acessória: política ausente ou inconsistente desliga somente a coleta, nunca a batida. */
export function effectiveRepPLocationPolicy(value: unknown, workspaceId: string, executionUnitId: string) {
  try { return parseRepPLocationPolicy(value, workspaceId, executionUnitId); }
  catch { return disabledRepPLocationPolicy(workspaceId, executionUnitId); }
}

export function canManageRepPLocationPolicy(context: ServerUserContext, unitId: string) {
  return Boolean((context.isDefaultAdmin || context.permissions.dp?.settings?.manageTime === true)
    && canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }));
}

function assertCanManage(context: ServerUserContext, unitId: string) {
  if (!canManageRepPLocationPolicy(context, unitId)) {
    throw fail('DP_TIME_LOCATION_POLICY_FORBIDDEN', 'A unidade não pertence ao seu escopo.', 'AUTHORIZATION');
  }
}

async function assertUnit(deps: Dependencies, unitId: string) {
  const unit = await deps.mainDb.collection('dp_units').doc(unitId).get();
  if (!unit.exists || unit.get('isArchived') === true) throw fail('DP_TIME_LOCATION_POLICY_NOT_FOUND', 'Unidade não encontrada.', 'NOT_FOUND');
  const externalId = String(unit.get('externalId') ?? '').trim() || null;
  return { id: unit.id, name: String(unit.get('name') ?? '').trim() || unit.id, externalId };
}

async function assertParticipants(deps: Dependencies, unit: { id: string; externalId: string | null }, participantUserIds: string[]) {
  const users = await deps.mainDb.getAll(...participantUserIds.map((userId) => deps.mainDb.collection('users').doc(userId)));
  const invalid = users.some((user) => {
    if (!user.exists || user.get('isActive') === false) return true;
    const unitIds = Array.isArray(user.get('unitIds')) ? user.get('unitIds') as unknown[] : [];
    const kioskIds = Array.isArray(user.get('assignedKioskIds')) ? user.get('assignedKioskIds') as unknown[] : [];
    return user.get('unitId') !== unit.id && !unitIds.includes(unit.id)
      && !(unit.externalId && kioskIds.includes(unit.externalId));
  });
  if (invalid) throw fail('DP_TIME_LOCATION_POLICY_PARTICIPANT_INVALID',
    'Uma das pessoas do piloto não está ativa ou não pertence a esta unidade.');
}

export async function readRepPLocationPolicy(context: ServerUserContext, unitId: string, injected: Partial<Dependencies> = {}) {
  assertCanManage(context, unitId);
  const deps = { ...defaults, ...injected };
  const unit = await assertUnit(deps, unitId);
  const snapshot = await repPLocationPolicyRef(deps.repDb, context.workspace_id, unitId).get();
  return { unit, policy: parseRepPLocationPolicy(snapshot.data(), context.workspace_id, unitId) };
}

export async function saveRepPLocationPolicy(context: ServerUserContext, unitId: string, raw: unknown,
  injected: Partial<Dependencies> = {}) {
  assertCanManage(context, unitId);
  const parsed = repPLocationPolicyInputSchema.safeParse(raw);
  if (!parsed.success) throw fail('DP_TIME_LOCATION_POLICY_INPUT_INVALID', parsed.error.issues[0]?.message ?? 'Política inválida.');
  const deps = { ...defaults, ...injected };
  const unit = await assertUnit(deps, unitId);
  if (parsed.data.mode === 'observe') await assertParticipants(deps, unit, parsed.data.participantUserIds);
  const ref = repPLocationPolicyRef(deps.repDb, context.workspace_id, unitId);
  const now = deps.now();
  const policy = await deps.repDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const current = parseRepPLocationPolicy(existing.data(), context.workspace_id, unitId);
    if (current.revision !== parsed.data.expectedRevision) {
      throw fail('DP_TIME_LOCATION_POLICY_CONFLICT', 'A política mudou. Recarregue antes de salvar novamente.', 'CONFLICT');
    }
    const revision = current.revision + 1;
    const activatedAt = parsed.data.mode === 'disabled' ? null : now.toISOString();
    const activatedBy = parsed.data.mode === 'disabled' ? null : context.decoded.uid;
    const next: RepPLocationPolicySnapshot = { schemaVersion: 1, workspaceId: context.workspace_id,
      executionUnitId: unitId, revision, mode: parsed.data.mode, center: parsed.data.center,
      radiusMeters: parsed.data.radiusMeters, maxAccuracyMeters: parsed.data.maxAccuracyMeters,
      maxAgeSeconds: parsed.data.maxAgeSeconds, captureTimeoutMs: parsed.data.captureTimeoutMs,
      privacyNoticeUrl: parsed.data.privacyNoticeUrl, legalBasisReference: parsed.data.legalBasisReference,
      retentionDays: parsed.data.retentionDays, participantUserIds: parsed.data.participantUserIds,
      activatedAt, activatedBy };
    transaction.set(ref, { ...next, updatedAt: Timestamp.fromDate(now), updatedBy: context.decoded.uid });
    transaction.create(ref.collection('revisions').doc(String(revision).padStart(8, '0')), {
      ...next, actorUid: context.decoded.uid, reason: parsed.data.mode === 'disabled' ? 'collection_disabled' : 'collection_activated',
      createdAt: Timestamp.fromDate(now), purpose: 'evidence_of_time_marking_for_human_review',
    });
    transaction.create(ref.collection('audit').doc(), { action: 'REP_P_LOCATION_POLICY_UPDATED', actorUid: context.decoded.uid,
      workspaceId: context.workspace_id, executionUnitId: unitId, revision, mode: next.mode,
      at: FieldValue.serverTimestamp() });
    return next;
  });
  return { unit, policy };
}

export async function loadRepPLocationPolicies(repDb: Firestore, workspaceId: string, unitIds: string[]) {
  if (!unitIds.length) return new Map<string, RepPLocationPolicySnapshot>();
  const unique = [...new Set(unitIds)].slice(0, 30);
  const snapshots = await repDb.getAll(...unique.map((unitId) => repPLocationPolicyRef(repDb, workspaceId, unitId)));
  return new Map(unique.map((unitId, index) => [unitId,
    effectiveRepPLocationPolicy(snapshots[index]?.data(), workspaceId, unitId)]));
}
