import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Filter, type Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit, resolveUnitAccess } from '@/lib/unit-access';
import { defaultGuestPermissions, type DPAbsenceType, type User } from '@/types';
import { requireAbsenceWorkflowReady } from '../catalog.server';
import { absenceResolutionTargetForUser, ownAbsenceResolutionTarget } from './service.server';
import { resolveAbsenceBeneficiary } from './beneficiary.server';
import { AbsencePreviewError, belemCivilDate, previewAbsenceRequest } from './core';
import { resolveAbsenceApprovers, type AbsenceApprovalStage } from './approval.server';
import { verifyAbsenceFiles, type AbsenceFileStore, absenceFileStore } from './files.server';
import { projectAbsenceRetentionCases } from './retention.server';
import { absenceDaySegments, intervalsOverlap, segmentBalances } from './reservations';
import type { CreateAbsenceDraftInput, AbsenceActionInput } from './workflow-schemas';
import type { AbsenceAttachment, AbsenceRequestDto, AbsenceRequestRecord } from './workflow-types';
import type { z } from 'zod';
import { absenceListQuerySchema } from './workflow-schemas';
import { dispatchAbsenceNotification } from './notifications.server';
import { ABSENCE_REVIEW_SLA_HOURS, createAbsenceReviewSla } from './review-sla';
import { operationalGuardRequested } from '../operational/occupancy-guard.server';
import { acknowledgeOperationalActivation, acknowledgeOperationalReversal, activateOperationalAbsence,
  beginOperationalIntent, markOperationalIntentPrepared, operationalIntentRef, prepareOperationalAbsence,
  reverseOperationalAbsence, type OperationalIntent } from '../operational/protocol.server';

const requests = hrDbAdmin.collection('dp_absenceRequests');
const days = hrDbAdmin.collection('dp_absenceDayReservations');
const balances = hrDbAdmin.collection('dp_absenceBalances');
const events = hrDbAdmin.collection('dp_absenceEvents');
const outbox = hrDbAdmin.collection('dp_absenceOutbox');
const occurrences = hrDbAdmin.collection('dp_absenceOccurrences');
const reversals = hrDbAdmin.collection('dp_absenceReversals');
const revisions = hrDbAdmin.collection('dp_absenceRevisions');
const preparations = hrDbAdmin.collection('dp_absencePreparations');
const idempotency = hrDbAdmin.collection('dp_absenceIdempotency');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
const snapshotHash = (value: unknown) => hash(JSON.stringify(canonical(value)));
function stableUuid(value: string) {
  const hex = hash(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const fail = (code: string, message: string, kind: 'VALIDATION' | 'CONFLICT' | 'AUTHORIZATION' | 'NOT_FOUND' = 'CONFLICT') => new AppError({ code, kind, safeMessage: message });
const nowIso = () => new Date().toISOString();
const operationHash = (input: AbsenceActionInput) => hash(JSON.stringify(input));

function fingerprint(target: NonNullable<Awaited<ReturnType<typeof ownAbsenceResolutionTarget>>>) {
  return hash(JSON.stringify([target.collaboratorId, target.employmentRelationshipType, target.unitId ?? null,
    target.unitGroupId ?? null, target.unitOrganizationId ?? null, target.jobRoleId ?? null, [...(target.jobFunctionIds ?? [])].sort()]));
}
function dto(value: AbsenceRequestRecord, actor: ServerUserContext): AbsenceRequestDto {
  const scopedInternalRequestAccess = (actor.isDefaultAdmin || actor.permissions.dp.requests.view === true
    || actor.permissions.dp.requests.review === true)
    && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin });
  const scopedScheduleEditor = (actor.isDefaultAdmin || actor.permissions.dp.schedules.edit === true)
    && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin });
  const scopedAbortReviewer = actor.decoded.uid !== value.beneficiaryUid && actor.decoded.uid !== value.requesterUid
    && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true
      && (value.assignedReviewerIds.includes(actor.decoded.uid) || value.custodianDpUid === actor.decoded.uid));
  return { id: value.id, status: value.status, version: value.version, revision: value.revision,
    origin: value.origin ?? 'collaborator',
    input: value.input, quantity: value.quantity, unit: value.unit, typeId: value.typeId,
    typeVersion: value.typeVersion, stage: value.stage, createdAt: value.createdAt,
    updatedAt: value.updatedAt, submittedAt: value.submittedAt, decidedAt: value.decidedAt,
    ...(scopedInternalRequestAccess && value.reviewSla ? { reviewSla: value.reviewSla } : {}),
    typeName: value.typeSnapshot.name, attachmentCount: value.attachments.length,
    ...(value.reason ? { reason: value.reason } : {}),
    approvedByInaction: value.status === 'approved' && value.approvalOrigin === 'tacit_timeout',
    ...(value.tacitApprovals?.length ? { tacitApprovals: value.tacitApprovals } : {}),
    tacitApprovalDays: value.policySnapshot.approvalFlow === 'automatic' ? null : value.policySnapshot.tacitApprovalDays ?? null,
    beneficiaryUid: value.beneficiaryUid, beneficiaryName: value.beneficiaryName ?? null,
    requesterUid: value.requesterUid, assignedReviewerIds: value.assignedReviewerIds,
    canCancel: value.status === 'approved'
      ? value.custodianDpUid === actor.decoded.uid && value.policySnapshot.allowFutureCancel
        && value.input.startDate > belemCivilDate(new Date())
        && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
        && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })
      : !value.operationalPending && value.requesterUid === actor.decoded.uid
        && ['draft', 'adjustments_requested', 'in_review'].includes(value.status),
    canConfirmProfile: !value.operationalPending && value.status === 'in_review' && value.custodianDpUid === actor.decoded.uid
      && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
      && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin }),
    profileReviewRequired: value.profileReviewRequired,
    attachments: value.attachments.filter((file) => file.deletion?.state !== 'removed').map(({ id, mime, size }) => ({ id, mime, size,
      canRead: !value.attachments.find((attachment) => attachment.id === id)?.deletion && (value.beneficiaryUid === actor.decoded.uid
        || value.custodianDpUid === actor.decoded.uid && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
          && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })
        || value.status === 'in_review' && value.assignedReviewerIds.includes(actor.decoded.uid)
          && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
          && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })),
    })),
    history: value.history,
    ...(value.operationalFence ? { operational: { state: value.operationalFence.state,
      operationallyApplied: value.operationalFence.state === 'active',
      canReconcile: scopedScheduleEditor && ['activation_pending', 'reversal_pending'].includes(value.operationalFence.state),
      canAbortPreparation: false } }
      : value.operationalPending ? { operational: { state: 'preparing' as const,
        operationallyApplied: false, canReconcile: false,
        canAbortPreparation: scopedScheduleEditor && scopedAbortReviewer } } : {}),
    canSubmit: !value.operationalPending && value.requesterUid === actor.decoded.uid
      && ['draft', 'adjustments_requested'].includes(value.status),
    canReview: !value.operationalPending && value.assignedReviewerIds.includes(actor.decoded.uid) && value.status === 'in_review'
      && actor.decoded.uid !== value.beneficiaryUid && actor.decoded.uid !== value.requesterUid
      && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
      && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin }),
  };
}
function ownOrReviewer(actor: ServerUserContext, value: AbsenceRequestRecord) {
  if (value.workspaceId !== actor.workspace_id) throw fail('ABSENCE_REQUEST_NOT_FOUND', 'Solicitação não encontrada.', 'NOT_FOUND');
  if (value.beneficiaryUid === actor.decoded.uid || value.requesterUid === actor.decoded.uid) return;
  if (value.status === 'in_review' && value.assignedReviewerIds.includes(actor.decoded.uid)
    && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
    && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) return;
  if ((actor.isDefaultAdmin || actor.permissions.dp.requests.view === true)
    && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) return;
  throw fail('ABSENCE_REQUEST_NOT_FOUND', 'Solicitação não encontrada.', 'NOT_FOUND');
}
function audit(tx: Transaction, value: AbsenceRequestRecord, actorUid: string, action: string, operationId: string) {
  const timestamp = nowIso();
  tx.create(events.doc(`${value.id}_${value.version}`), { requestId: value.id, workspaceId: value.workspaceId,
    action, actorUid, operationId, version: value.version, at: timestamp });
  tx.create(hrDbAdmin.collection('dp_absenceAudit').doc(`${value.id}_${value.version}`), { requestId: value.id,
    workspaceId: value.workspaceId, beneficiaryUid: value.beneficiaryUid, actorUid, action, at: timestamp,
    ttl: new Date(Date.now() + 365 * 86_400_000) });
}
function queue(tx: Transaction, value: AbsenceRequestRecord, eventId: string, kind: string, recipients: string[]) {
  tx.create(outbox.doc(`${value.id}_${value.version}_${kind}`), { eventId: stableUuid(eventId), requestId: value.id, requestVersion: value.version,
    workspaceId: value.workspaceId, kind, recipients: [...new Set(recipients)], status: 'pending', attempts: 0,
    createdAt: nowIso(), nextAttemptAt: nowIso(), payload: { requestId: value.id } });
}
function dayRef(value: AbsenceRequestRecord, date: string) { return days.doc(hash(`${value.workspaceId}:${value.beneficiaryUid}:${date}`)); }
function balanceRef(value: AbsenceRequestRecord, period: string) {
  return balances.doc(hash([value.workspaceId, value.beneficiaryUid, value.lineageId, value.policyId, value.unit, period].join(':')));
}
function minorLimit(value: AbsenceRequestRecord) {
  return value.policySnapshot.maxUnitsPerPeriod === undefined ? null : value.policySnapshot.maxUnitsPerPeriod * (value.unit === 'hour' ? 60 : 1);
}
async function readReservationState(tx: Transaction, value: AbsenceRequestRecord) {
  const periods = segmentBalances(value.segments);
  const dayRefs = value.segments.map((segment) => dayRef(value, segment.date));
  const balanceRefs = [...periods.keys()].map((period) => balanceRef(value, period));
  const [dayDocs, balanceDocs] = await Promise.all([
    Promise.all(dayRefs.map((ref) => tx.get(ref))), Promise.all(balanceRefs.map((ref) => tx.get(ref))),
  ]);
  return { periods, dayRefs, balanceRefs, dayDocs, balanceDocs };
}
function reserve(tx: Transaction, value: AbsenceRequestRecord, state: Awaited<ReturnType<typeof readReservationState>>, mode: 'add' | 'release' | 'consume' | 'approve_add') {
  value.segments.forEach((segment, index) => {
    const snapshot = state.dayDocs[index];
    const raw = snapshot.exists ? snapshot.get('intervals') : [];
    if (!Array.isArray(raw) || raw.length > 20 || raw.some((entry) => !entry || typeof entry.requestId !== 'string'
      || !Number.isInteger(entry.fromMinute) || !Number.isInteger(entry.toMinute)
      || entry.fromMinute < 0 || entry.toMinute > 1440 || entry.fromMinute >= entry.toMinute)) {
      throw fail('ABSENCE_RESERVATION_INTEGRITY', 'Reserva de ausências inconsistente.');
    }
    const existing = raw as Array<{ requestId: string; fromMinute: number; toMinute: number }>;
    if ((mode === 'release' || mode === 'consume') && existing.filter((entry) => entry.requestId === value.id
      && entry.fromMinute === segment.fromMinute && entry.toMinute === segment.toMinute).length !== 1) {
      throw fail('ABSENCE_RESERVATION_INTEGRITY', 'Reserva de ausências inconsistente.');
    }
    const filtered = existing.filter((entry) => entry.requestId !== value.id);
    if ((mode === 'add' || mode === 'approve_add') && filtered.some((entry) => intervalsOverlap(entry, segment))) throw fail('ABSENCE_PERIOD_OVERLAP', 'Há outra ausência ativa neste período.');
    const intervals = mode === 'add' || mode === 'approve_add' ? [...filtered, { requestId: value.id, fromMinute: segment.fromMinute, toMinute: segment.toMinute }] : mode === 'consume' ? existing : filtered;
    if (intervals.length > 20) throw fail('ABSENCE_DAY_LIMIT', 'Há ocorrências demais neste dia.');
    tx.set(state.dayRefs[index], { workspaceId: value.workspaceId, beneficiaryUid: value.beneficiaryUid,
      date: segment.date, intervals, updatedAt: nowIso() });
  });
  [...state.periods].forEach(([period, delta], index) => {
    const snapshot = state.balanceDocs[index];
    const reservedRaw = snapshot.exists ? snapshot.get('reservedMinor') : 0;
    const consumedRaw = snapshot.exists ? snapshot.get('consumedMinor') : 0;
    if (!Number.isSafeInteger(reservedRaw) || !Number.isSafeInteger(consumedRaw) || reservedRaw < 0 || consumedRaw < 0) {
      throw fail('ABSENCE_BALANCE_INTEGRITY', 'Saldo de ausências inconsistente.');
    }
    const reserved = reservedRaw as number;
    const consumed = consumedRaw as number;
    const nextReserved = reserved + (mode === 'add' ? delta : mode === 'consume' || mode === 'release' && value.status !== 'approved' ? -delta : 0);
    const nextConsumed = consumed + (mode === 'consume' || mode === 'approve_add' ? delta : mode === 'release' && value.status === 'approved' ? -delta : 0);
    const correctedReserved = nextReserved;
    if (correctedReserved < 0 || nextConsumed < 0) throw fail('ABSENCE_BALANCE_INTEGRITY', 'Saldo de ausências inconsistente.');
    const limit = minorLimit(value);
    if ((mode === 'add' || mode === 'approve_add') && limit !== null && correctedReserved + nextConsumed > limit) throw fail('ABSENCE_BALANCE_EXCEEDED', 'Limite acumulado do período excedido.');
    tx.set(state.balanceRefs[index], { workspaceId: value.workspaceId, beneficiaryUid: value.beneficiaryUid,
      lineageId: value.lineageId, policyId: value.policyId, unitId: value.unitId, unit: value.unit,
      period, reservedMinor: correctedReserved, consumedMinor: nextConsumed, updatedAt: nowIso() });
  });
}

async function assertNoApprovedVacation(value: AbsenceRequestRecord) {
  const lastAbsentDate = value.segments.at(-1)!.date;
  const snapshot = await dbAdmin.collection('dp_vacations').where('userId', '==', value.beneficiaryUid)
    .where('endDate', '>=', value.input.startDate).limit(51).get();
  if (snapshot.size > 50) throw fail('ABSENCE_VACATION_CHECK_LIMIT', 'Não foi possível confirmar conflitos com férias.');
  if (snapshot.docs.some((doc) => doc.get('recordType') === 'gozo' && doc.get('status') === 'APPROVED'
    && String(doc.get('startDate')) <= lastAbsentDate)) throw fail('ABSENCE_VACATION_CONFLICT', 'O período coincide com férias aprovadas.');
}

export async function createAbsenceDraft(actor: ServerUserContext, input: CreateAbsenceDraftInput, store: AbsenceFileStore = absenceFileStore) {
  await requireAbsenceWorkflowReady();
  const { target, origin, beneficiary } = await resolveAbsenceBeneficiary(actor, input.beneficiaryUid);
  if (!target?.unitId) throw fail('ABSENCE_PROFILE_UNAVAILABLE', 'Vínculo ou lotação indisponível para solicitação.');
  const unitId = target.unitId;
  const requestId = input.proposedRequestId ?? randomUUID();
  if (input.preparationIds.length && !input.proposedRequestId) throw fail('ABSENCE_PREPARATION_REQUIRED', 'Informe a preparação dos comprovantes.', 'VALIDATION');
  const prepRef = input.preparationIds.length ? preparations.doc(requestId) : null;
  const prep = prepRef ? await prepRef.get() : null;
  const files = prep?.exists ? (prep.get('files') ?? []) as AbsenceAttachment[] : [];
  if (input.preparationIds.length && (files.length !== input.preparationIds.length || files.some((file) => !input.preparationIds.includes(file.id)))) throw fail('ABSENCE_PREPARATION_INVALID', 'Comprovantes indisponíveis.');
  await verifyAbsenceFiles(files, store);
  const keyRef = idempotency.doc(hash(`${actor.workspace_id}:${actor.decoded.uid}:${input.idempotencyKey}`));
  const requestHash = hash(JSON.stringify(input));
  const result = await hrDbAdmin.runTransaction(async (tx) => {
    const [key, type, prepared] = await Promise.all([
      tx.get(keyRef), tx.get(hrDbAdmin.collection('dp_absenceTypes').doc(input.request.absenceTypeId)), prepRef ? tx.get(prepRef) : null,
    ]);
    if (key.exists) {
      const existing = await tx.get(requests.doc(String(key.get('requestId'))));
      if (existing.exists && existing.get('requesterUid') === actor.decoded.uid && existing.get('workspaceId') === actor.workspace_id
        && existing.get('beneficiaryUid') === beneficiary.id && key.get('requestHash') === requestHash) return existing.data() as AbsenceRequestRecord;
      throw fail('ABSENCE_IDEMPOTENCY_CONFLICT', 'Chave de repetição inválida.');
    }
    if (!type.exists) throw fail('ABSENCE_TYPE_UNAVAILABLE', 'Tipo de ausência indisponível.', 'NOT_FOUND');
    const absenceType = { id: type.id, ...type.data() } as DPAbsenceType;
    let preview;
    try { preview = previewAbsenceRequest(input.request, absenceType, target, belemCivilDate(new Date()), 'coala-rh', origin); }
    catch (error) {
      if (error instanceof AbsencePreviewError) throw fail('ABSENCE_REQUEST_UNAVAILABLE', 'Tipo ou período indisponível para solicitação.', 'VALIDATION');
      throw error;
    }
    if (preview.quantity.value === null) throw fail('ABSENCE_QUANTITY_UNAVAILABLE', 'Jornada necessária para contar dias previstos ainda não está disponível.');
    if (preview.attachmentRequired && !files.length) throw fail('ABSENCE_DOCUMENT_REQUIRED', 'Anexe o documento exigido antes de criar a solicitação.', 'VALIDATION');
    if (prepRef && (!prepared?.exists || prepared.get('ownerUid') !== actor.decoded.uid || prepared.get('beneficiaryUid') !== beneficiary.id
      || prepared.get('workspaceId') !== actor.workspace_id || prepared.get('status') !== 'prepared' || String(prepared.get('expiresAt')) <= nowIso())) {
      throw fail('ABSENCE_PREPARATION_UNAVAILABLE', 'Comprovantes indisponíveis.');
    }
    const policy = absenceType.policies.find((candidate) => candidate.id === preview.rule.id)!;
    const requiresCustodian = files.length > 0 || policy.allowFutureCancel
      || policy.approvalFlow === 'dp' || policy.approvalFlow === 'manager_then_dp';
    const custodian = requiresCustodian ? await resolveAbsenceApprovers(policy, 'dp', beneficiary.id, target.unitId) : null;
    const timestamp = nowIso();
    const value: AbsenceRequestRecord = {
      id: requestId, workspaceId: actor.workspace_id, requesterUid: actor.decoded.uid, beneficiaryUid: beneficiary.id,
      beneficiaryName: typeof beneficiary.username === 'string' ? beneficiary.username.slice(0, 120) : null, unitId, origin,
      status: 'draft', version: 1, revision: 1, input: input.request,
      startDate: input.request.startDate, endDate: input.request.endDate,
      quantity: preview.quantity.value, unit: input.request.unit,
      typeId: absenceType.id, lineageId: absenceType.lineageId, typeVersion: absenceType.version,
      typeSnapshot: { name: absenceType.name, workdayEffect: absenceType.workdayEffect, blocksSchedule: absenceType.blocksSchedule,
        includeInAbsenteeism: absenceType.includeInAbsenteeism, validFrom: absenceType.validFrom,
        ...(absenceType.validTo ? { validTo: absenceType.validTo } : {}) },
      policyId: policy.id, policySnapshot: structuredClone(policy), profileFingerprint: fingerprint(target), profileReviewRequired: false,
      attachments: files, custodianDpUid: custodian?.reviewerIds[0] ?? null, segments: absenceDaySegments(input.request, policy),
      stage: null, stageIndex: -1, assignedReviewerIds: [], history: [{ action: 'created', actorUid: actor.decoded.uid, at: timestamp, version: 1 }],
      createdAt: timestamp, updatedAt: timestamp,
      ...(input.reason ? { reason: input.reason } : {}),
    };
    tx.create(requests.doc(requestId), value);
    projectAbsenceRetentionCases(tx, value, files);
    tx.create(keyRef, { requestId, requesterUid: actor.decoded.uid, beneficiaryUid: beneficiary.id,
      requestHash, workspaceId: actor.workspace_id, createdAt: timestamp });
    if (prepRef) tx.update(prepRef, { status: 'claimed', requestId, claimedAt: timestamp });
    audit(tx, value, actor.decoded.uid, 'created', input.idempotencyKey);
    return value;
  });
  return dto(result, actor);
}

export async function getAbsenceRequest(actor: ServerUserContext, requestId: string) {
  await requireAbsenceWorkflowReady();
  const snapshot = await requests.doc(requestId).get();
  if (!snapshot.exists) throw fail('ABSENCE_REQUEST_NOT_FOUND', 'Solicitação não encontrada.', 'NOT_FOUND');
  const value = snapshot.data() as AbsenceRequestRecord;
  ownOrReviewer(actor, value);
  const result = dto(value, actor);
  let approverIds = value.status === 'in_review' ? value.assignedReviewerIds : [];
  let approvalPending = false;
  if (['draft', 'adjustments_requested'].includes(value.status)) {
    const stage = nextStage(value);
    if (stage) {
      try {
        approverIds = (await resolveAbsenceApprovers(value.policySnapshot, stage, value.beneficiaryUid,
          value.unitId, value.requesterUid)).reviewerIds;
      } catch (error) {
        if (!(error instanceof AppError) || !['ABSENCE_APPROVAL_UNCONFIGURED', 'ABSENCE_APPROVER_UNAVAILABLE'].includes(error.code)) throw error;
        approvalPending = true;
      }
    }
  }
  const approvers = approverIds.length ? await dbAdmin.getAll(...approverIds.slice(0, 20).map((uid) => dbAdmin.collection('users').doc(uid))) : [];
  const periods = [...segmentBalances(value.segments).keys()];
  const balanceDocs = periods.length ? await hrDbAdmin.getAll(...periods.map((period) => balanceRef(value, period))) : [];
  const factor = value.unit === 'hour' ? 60 : 1;
  const limit = minorLimit(value);
  const balancesForUi = periods.map((period, index) => {
    const document = balanceDocs[index];
    const reserved = document.exists ? document.get('reservedMinor') : 0;
    const consumed = document.exists ? document.get('consumedMinor') : 0;
    if (!Number.isSafeInteger(reserved) || !Number.isSafeInteger(consumed) || reserved < 0 || consumed < 0) {
      throw fail('ABSENCE_BALANCE_INTEGRITY', 'Saldo de ausências inconsistente.');
    }
    return { period, limit: limit === null ? null : limit / factor,
      remaining: limit === null ? null : Math.max(0, (limit - reserved - consumed) / factor) };
  });
  const beneficiary = await dbAdmin.collection('users').doc(value.beneficiaryUid).get();
  result.beneficiaryName = beneficiary.exists && typeof beneficiary.get('username') === 'string'
    ? String(beneficiary.get('username')).slice(0, 120) : result.beneficiaryName;
  const liveTarget = beneficiary.exists ? await absenceResolutionTargetForUser({ id: beneficiary.id, ...beneficiary.data() } as User) : null;
  const profileReviewRequired = value.profileReviewRequired || !liveTarget || fingerprint(liveTarget) !== value.profileFingerprint;
  result.profileReviewRequired = profileReviewRequired;
  const scopedInternalRequestAccess = (actor.isDefaultAdmin || actor.permissions.dp.requests.view === true
    || actor.permissions.dp.requests.review === true)
    && canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin });
  result.preflight = { approvers: approvers.filter((item) => item.exists).map((item) => ({ uid: item.id,
    name: String(item.get('username') ?? 'Responsável') })), approvalPending,
    balances: balancesForUi, profileReviewRequired,
    ...(scopedInternalRequestAccess ? { approvalSlaHours: ABSENCE_REVIEW_SLA_HOURS } : {}) };
  return result;
}

export async function listAbsenceRequests(actor: ServerUserContext, options: z.infer<typeof absenceListQuerySchema>) {
  await requireAbsenceWorkflowReady();
  if (options.scope === 'mine' && !actor.isDefaultAdmin && (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) !== true) {
    throw fail('ABSENCE_OWN_LIST_FORBIDDEN', 'Sem permissão para listar suas solicitações.', 'AUTHORIZATION');
  }
  if (options.scope === 'review' && !actor.isDefaultAdmin && actor.permissions.dp.requests.review !== true) throw fail('ABSENCE_REVIEW_FORBIDDEN', 'Sem permissão para revisar solicitações.', 'AUTHORIZATION');
  if (options.scope === 'team' && !actor.isDefaultAdmin && actor.permissions.dp.requests.view !== true) throw fail('ABSENCE_TEAM_FORBIDDEN', 'Sem permissão para consultar a equipe.', 'AUTHORIZATION');
  if (options.scope === 'review' && options.status && options.status !== 'in_review') throw fail('ABSENCE_LIST_INPUT_INVALID', 'Status inválido para revisão.', 'VALIDATION');
  if (options.overdueOnly && options.scope === 'mine') throw fail('ABSENCE_LIST_INPUT_INVALID', 'Filtro de vencimento indisponível.', 'VALIDATION');
  const access = resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin });
  if (options.unitId && options.scope !== 'mine' && !canAccessUnit(actor.userDoc, options.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    throw fail('ABSENCE_LIST_INPUT_INVALID', 'Unidade indisponível.', 'VALIDATION');
  }
  if (options.scope !== 'mine' && !options.unitId && !access.allUnits && access.unitIds.length > 30) {
    throw fail('ABSENCE_UNIT_FILTER_REQUIRED', 'Escolha uma unidade para consultar.', 'VALIDATION');
  }
  let query: FirebaseFirestore.Query = requests.where('workspaceId', '==', actor.workspace_id);
  if (options.scope === 'mine') query = query.where(Filter.or(
    Filter.where('beneficiaryUid', '==', actor.decoded.uid),
    Filter.where('requesterUid', '==', actor.decoded.uid)));
  if (options.scope === 'review') query = query.where('assignedReviewerIds', 'array-contains', actor.decoded.uid).where('status', '==', 'in_review');
  if (options.scope === 'team') query = query.where('status', '==', options.status ?? 'in_review');
  else if (options.scope === 'mine' && options.status) query = query.where('status', '==', options.status);
  if (options.beneficiaryUid) query = query.where('beneficiaryUid', '==', options.beneficiaryUid);
  if (options.scope !== 'mine') {
    if (options.unitId) query = query.where('unitId', '==', options.unitId);
    else if (!access.allUnits) {
      if (!access.unitIds.length) return { requests: [], nextCursor: null };
      query = query.where('unitId', 'in', access.unitIds);
    }
  }
  if (options.scope === 'mine' && options.unitId) query = query.where('unitId', '==', options.unitId);
  if (options.startDate) query = query.where('startDate', '>=', options.startDate);
  if (options.endDate) query = query.where('startDate', '<=', options.endDate);
  if (options.overdueOnly) query = query.where('reviewSla.deadlineAt', '<', nowIso())
    .orderBy('reviewSla.deadlineAt', 'asc').orderBy(FieldPath.documentId(), 'asc');
  else query = query.orderBy('startDate', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (options.cursor) {
    const cursor = await requests.doc(options.cursor).get();
    if (!cursor.exists || cursor.get('workspaceId') !== actor.workspace_id || (options.scope === 'mine'
      && cursor.get('beneficiaryUid') !== actor.decoded.uid && cursor.get('requesterUid') !== actor.decoded.uid)
      || (options.scope === 'review' && (!(cursor.get('assignedReviewerIds') ?? []).includes(actor.decoded.uid) || cursor.get('status') !== 'in_review'))
      || (options.scope === 'team' && cursor.get('status') !== (options.status ?? 'in_review'))
      || (options.status && cursor.get('status') !== options.status)
      || (options.beneficiaryUid && cursor.get('beneficiaryUid') !== options.beneficiaryUid)
      || (options.unitId && cursor.get('unitId') !== options.unitId)
      || (options.scope !== 'mine' && !access.allUnits && !access.unitIds.includes(String(cursor.get('unitId'))))
      || (options.startDate && String(cursor.get('startDate')) < options.startDate)
      || (options.endDate && String(cursor.get('startDate')) > options.endDate)) throw fail('ABSENCE_CURSOR_INVALID', 'Cursor inválido.', 'VALIDATION');
    if (options.overdueOnly && (cursor.get('status') !== 'in_review'
      || typeof cursor.get('reviewSla.deadlineAt') !== 'string'
      || String(cursor.get('reviewSla.deadlineAt')) >= nowIso())) throw fail('ABSENCE_CURSOR_INVALID', 'Cursor inválido.', 'VALIDATION');
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(options.limit + 1).get();
  const rows = snapshot.docs.slice(0, options.limit).map((doc) => doc.data() as AbsenceRequestRecord);
  return { requests: rows.map((value) => dto(value, actor)),
    nextCursor: snapshot.size > options.limit ? snapshot.docs[options.limit - 1].id : null };
}

function nextStage(value: AbsenceRequestRecord): AbsenceApprovalStage | null {
  if (value.policySnapshot.approvalFlow === 'automatic') return null;
  if (value.stage === null) return value.policySnapshot.approvalFlow === 'dp' ? 'dp' : 'manager';
  return value.stage === 'manager' && value.policySnapshot.approvalFlow === 'manager_then_dp' ? 'dp' : null;
}

function checkReviewer(actor: ServerUserContext, value: AbsenceRequestRecord) {
  if (actor.decoded.uid === value.beneficiaryUid || actor.decoded.uid === value.requesterUid
    || !value.assignedReviewerIds.includes(actor.decoded.uid)
    || (!actor.isDefaultAdmin && actor.permissions.dp.requests.review !== true)
    || !canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    throw fail('ABSENCE_REVIEW_FORBIDDEN', 'Sem permissão para esta decisão.', 'AUTHORIZATION');
  }
}

function checkCustodian(actor: ServerUserContext, value: AbsenceRequestRecord) {
  if (value.custodianDpUid !== actor.decoded.uid || actor.decoded.uid === value.beneficiaryUid
    || (!actor.isDefaultAdmin && actor.permissions.dp.requests.review !== true)
    || !canAccessUnit(actor.userDoc, value.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    throw fail('ABSENCE_CUSTODIAN_FORBIDDEN', 'Sem permissão para esta confirmação.', 'AUTHORIZATION');
  }
}

/** Ator de sistema da aprovação por decurso de prazo; nunca é uma pessoa nem tem perfil. */
export const ABSENCE_TACIT_ACTOR_UID = 'system:absence-tacit-approval';
const TACIT_BATCH_LIMIT = 50;

function tacitOperationId(requestId: string, version: number) {
  const digest = createHash('sha256').update(`tacit:${requestId}:${version}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/**
 * Aprova por decurso de prazo as etapas em análise cuja regra define `tacitApprovalDays`, contados em dias
 * corridos desde a atribuição da etapa (`reviewSla.startedAt`). Percorre com cursor os pedidos em análise já fora
 * do prazo de 24 h (páginas de 100, até 1.000 lidos por execução), para que vencidos de regras sem decurso não
 * escondam os que já devem ser aprovados; aprova no máximo 50 por execução. Cada aprovação usa o mesmo caminho da
 * análise humana (reservas, escala e notificação) com operationId determinístico; o que exigir confirmação humana
 * (perfil, conflito, regra mudada) fica para o DP e aparece em `skippedCodes`.
 */
export async function applyTacitAbsenceApprovals(workspaceId: string, now = new Date(), store: AbsenceFileStore = absenceFileStore,
  limits: { pageSize?: number; maxScanned?: number; maxApprovals?: number } = {}) {
  await requireAbsenceWorkflowReady();
  const pageSize = limits.pageSize ?? 100;
  const maxScanned = limits.maxScanned ?? 1_000;
  const maxApprovals = limits.maxApprovals ?? TACIT_BATCH_LIMIT;
  // Usa o índice workspaceId + status + reviewSla.deadlineAt já existente para a fila de vencidos.
  const base = requests.where('workspaceId', '==', workspaceId).where('status', '==', 'in_review')
    .where('reviewSla.deadlineAt', '<', now.toISOString()).orderBy('reviewSla.deadlineAt', 'asc');
  const result = { checked: 0, approved: 0, skipped: 0, notDue: 0, skippedCodes: {} as Record<string, number> };
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (result.checked < maxScanned && result.approved < maxApprovals) {
    const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).limit(pageSize).get();
    for (const doc of page.docs) {
      if (result.approved >= maxApprovals) break;
      result.checked++;
      const value = doc.data() as AbsenceRequestRecord;
      const days = value.policySnapshot.approvalFlow === 'automatic' ? undefined : value.policySnapshot.tacitApprovalDays;
      const startedAt = Date.parse(value.reviewSla?.startedAt ?? '');
      if (!days || !Number.isFinite(startedAt) || startedAt + days * 86_400_000 > now.getTime()) { result.notDue++; continue; }
      try {
        await actOnAbsenceRequest(tacitActor(value.workspaceId), value.id,
          { action: 'approve', expectedVersion: value.version, operationId: tacitOperationId(value.id, value.version) },
          store, { tacitTimeout: { days } });
        result.approved++;
      } catch (error) {
        // Só o código opaco do erro: o pedido segue em análise com o DP, e a contagem fica visível no log da rotina.
        const code = error instanceof AppError ? error.code : 'ABSENCE_TACIT_UNEXPECTED';
        result.skipped++;
        result.skippedCodes[code] = (result.skippedCodes[code] ?? 0) + 1;
      }
    }
    if (page.size < pageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return result;
}

function tacitActor(workspaceId: string): ServerUserContext {
  return { decoded: { uid: ABSENCE_TACIT_ACTOR_UID }, userDoc: { id: ABSENCE_TACIT_ACTOR_UID }, profileId: null,
    permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false, workspace_id: workspaceId } as unknown as ServerUserContext;
}

export async function actOnAbsenceRequest(actor: ServerUserContext, requestId: string, input: AbsenceActionInput, store: AbsenceFileStore = absenceFileStore,
  /** Só a rotina de decurso de prazo usa: aprova a etapa vencida como ator de sistema, pelo mesmo caminho da análise humana. */
  options: { tacitTimeout?: { days: number } } = {}) {
  await requireAbsenceWorkflowReady();
  const currentDoc = await requests.doc(requestId).get();
  if (!currentDoc.exists || currentDoc.get('workspaceId') !== actor.workspace_id) throw fail('ABSENCE_REQUEST_NOT_FOUND', 'Solicitação não encontrada.', 'NOT_FOUND');
  const current = currentDoc.data() as AbsenceRequestRecord;
  const tacit = options.tacitTimeout ?? null;
  if (tacit && (input.action !== 'approve' || actor.decoded.uid !== ABSENCE_TACIT_ACTOR_UID || current.status !== 'in_review')) {
    throw fail('ABSENCE_ACTION_FORBIDDEN', 'Ação indisponível.', 'AUTHORIZATION');
  }
  if (!tacit) ownOrReviewer(actor, current);
  if (current.operationalPending && (current.operationalPending.operationId !== input.operationId
    || current.operationalPending.actorUid !== actor.decoded.uid
    || current.operationalPending.actionHash !== operationHash(input))) {
    throw fail('ABSENCE_OPERATIONAL_IN_PROGRESS', 'Há um preparo operacional pendente. Reconcilie antes de alterar.');
  }
  if (current.lastOperationId === input.operationId) {
    if (current.lastOperationActorUid !== actor.decoded.uid || current.lastOperationAction !== input.action
      || current.lastOperationHash !== operationHash(input)) throw fail('ABSENCE_IDEMPOTENCY_CONFLICT', 'Chave de repetição inválida.');
    return dto(current, actor);
  }
  if (current.version !== input.expectedVersion) throw fail('ABSENCE_VERSION_CONFLICT', 'A solicitação foi alterada. Atualize e tente novamente.');
  const isRequester = current.requesterUid === actor.decoded.uid;
  if (input.action === 'submit' && (!isRequester
    || !['draft', 'adjustments_requested'].includes(current.status))) throw fail('ABSENCE_ACTION_FORBIDDEN', 'Ação indisponível.', 'AUTHORIZATION');
  if (input.action === 'update_draft' && (!isRequester || !['draft', 'adjustments_requested'].includes(current.status))) {
    throw fail('ABSENCE_ACTION_FORBIDDEN', 'Ação indisponível.', 'AUTHORIZATION');
  }
  if (['approve', 'reject', 'request_adjustments'].includes(input.action) && !tacit) {
    if (current.status !== 'in_review') throw fail('ABSENCE_ACTION_FORBIDDEN', 'Ação indisponível.', 'AUTHORIZATION');
    checkReviewer(actor, current);
    const live = await resolveAbsenceApprovers(current.policySnapshot, current.stage!, current.beneficiaryUid, current.unitId, current.requesterUid);
    if (!live.reviewerIds.includes(actor.decoded.uid)) throw fail('ABSENCE_REVIEW_CHANGED', 'A atribuição da etapa mudou. Atualize a solicitação.', 'AUTHORIZATION');
  }
  if (input.action === 'confirm_profile') {
    if (current.status !== 'in_review') throw fail('ABSENCE_ACTION_FORBIDDEN', 'Ação indisponível.', 'AUTHORIZATION');
    checkCustodian(actor, current);
  }
  if (input.action === 'cancel') {
    if (current.status === 'approved') {
      checkCustodian(actor, current);
      if (!current.policySnapshot.allowFutureCancel) throw fail('ABSENCE_CANCEL_DISABLED', 'Cancelamento não permitido para este tipo.');
      if (current.input.startDate <= belemCivilDate(new Date())) throw fail('ABSENCE_CANCEL_NOT_FUTURE', 'Cancelamento aprovado disponível somente antes do início.');
    } else if (!isRequester || !['draft', 'adjustments_requested', 'in_review'].includes(current.status)) {
      throw fail('ABSENCE_ACTION_FORBIDDEN', 'Ação indisponível.', 'AUTHORIZATION');
    }
  }
  if (input.action === 'reject' && current.policySnapshot.rejectionReasonRequired && (!input.reason || input.reason.length < 10)) {
    throw fail('ABSENCE_REJECTION_REASON_REQUIRED', 'Informe o motivo da recusa.', 'VALIDATION');
  }

  const requiresRequesterAuthority = ['submit', 'update_draft'].includes(input.action)
    || input.action === 'cancel' && current.status !== 'approved';
  const resolvedSubmit = requiresRequesterAuthority ? await resolveAbsenceBeneficiary(actor, current.beneficiaryUid) : null;
  if (resolvedSubmit && resolvedSubmit.origin !== (current.origin ?? 'collaborator')) {
    throw fail('ABSENCE_AUTHORITY_CHANGED', 'A origem da solicitação não está mais autorizada.', 'AUTHORIZATION');
  }
  const target = resolvedSubmit?.target ?? null;
  // Decision review compares the beneficiary, never the reviewer's profile.
  const beneficiary = ['approve', 'confirm_profile'].includes(input.action)
    ? await dbAdmin.collection('users').doc(current.beneficiaryUid).get() : null;
  const beneficiaryTarget = beneficiary?.exists ? await absenceResolutionTargetForUser({ id: beneficiary.id, ...beneficiary.data() } as User) : null;
  const liveFingerprint = beneficiaryTarget ? fingerprint(beneficiaryTarget) : null;
  const profileDrift = input.action === 'approve' && liveFingerprint !== current.profileFingerprint;
  if (input.action === 'submit') await verifyAbsenceFiles(current.attachments, store);
  const prepRef = input.action === 'update_draft' && input.preparationRef ? preparations.doc(input.preparationRef) : null;
  const preparedOutside = prepRef ? await prepRef.get() : null;
  const newFiles = preparedOutside?.exists ? (preparedOutside.get('files') ?? []) as AbsenceAttachment[] : [];
  if (input.action === 'update_draft') {
    if (input.preparationIds.length && !prepRef) throw fail('ABSENCE_PREPARATION_REQUIRED', 'Informe a preparação dos comprovantes.', 'VALIDATION');
    if (newFiles.length !== input.preparationIds.length || newFiles.some((file) => !input.preparationIds.includes(file.id))) {
      throw fail('ABSENCE_PREPARATION_INVALID', 'Comprovantes indisponíveis.');
    }
    await verifyAbsenceFiles(newFiles, store);
  }
  const finalApproval = input.action === 'approve' && nextStage(current) === null
    || input.action === 'submit' && current.policySnapshot.approvalFlow === 'automatic';
  if (finalApproval && input.action === 'approve') await verifyAbsenceFiles(current.attachments, store);
  if (['approve', 'confirm_profile'].includes(input.action) && !beneficiaryTarget) throw fail('ABSENCE_BENEFICIARY_INACTIVE', 'Vínculo ativo do titular não confirmado. Decisão bloqueada.');
  if (finalApproval) await assertNoApprovedVacation(current);
  if (input.action === 'approve' && input.confirmProfile) {
    checkCustodian(actor, current);
    if (!input.profileReason) throw fail('ABSENCE_PROFILE_REASON_REQUIRED', 'Informe o motivo da confirmação.', 'VALIDATION');
  }
  const next = input.action === 'submit' || input.action === 'approve' ? nextStage(current) : null;
  const assignment = next ? await resolveAbsenceApprovers(current.policySnapshot, next, current.beneficiaryUid, current.unitId, current.requesterUid) : null;
  if (input.action === 'submit' && !assignment && current.attachments.length && !current.custodianDpUid) {
    throw fail('ABSENCE_CUSTODIAN_REQUIRED', 'Responsável de DP pelos documentos não configurado.');
  }
  let operationalIntent: OperationalIntent | null = null;
  let operationalEpoch: string | null = null;
  if (finalApproval && !operationalGuardRequested() && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw fail('ABSENCE_OPERATIONAL_PRODUCTION_NOT_READY',
      'A aprovação final aguarda a reconciliação operacional de escala e férias.');
  }
  if (finalApproval && operationalGuardRequested()) {
    operationalIntent = await beginOperationalIntent(current, actor.decoded.uid, input.operationId, operationHash(input));
    operationalEpoch = (await prepareOperationalAbsence(operationalIntent)).epoch;
    await markOperationalIntentPrepared(operationalIntent, operationalEpoch!);
  }
  let reversalIntent: OperationalIntent | null = null;
  if (input.action === 'cancel' && current.status === 'approved' && current.operationalFence) {
    if (!operationalGuardRequested()) throw fail('ABSENCE_OPERATIONAL_GUARD_REQUIRED', 'Cancelamento operacional indisponível.');
    const intentDoc = await operationalIntentRef(current.id, current.operationalFence.requestVersion - 1).get();
    if (!intentDoc.exists || intentDoc.get('fenceId') !== current.operationalFence.fenceId
      || !['committed', 'active'].includes(String(intentDoc.get('status')))) {
      throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED', 'Projeção operacional indisponível.');
    }
    reversalIntent = intentDoc.data() as OperationalIntent;
  }
  const result = await hrDbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(requests.doc(requestId));
    if (!snapshot.exists || snapshot.get('workspaceId') !== actor.workspace_id) throw fail('ABSENCE_REQUEST_NOT_FOUND', 'Solicitação não encontrada.', 'NOT_FOUND');
    const original = snapshot.data() as AbsenceRequestRecord;
    if (original.operationalPending && (original.operationalPending.operationId !== input.operationId
      || original.operationalPending.actorUid !== actor.decoded.uid
      || original.operationalPending.actionHash !== operationHash(input))) {
      throw fail('ABSENCE_OPERATIONAL_IN_PROGRESS', 'Há um preparo operacional pendente. Reconcilie antes de alterar.');
    }
    if (original.lastOperationId === input.operationId) {
      if (original.lastOperationActorUid !== actor.decoded.uid || original.lastOperationAction !== input.action
        || original.lastOperationHash !== operationHash(input)) throw fail('ABSENCE_IDEMPOTENCY_CONFLICT', 'Chave de repetição inválida.');
      return original;
    }
    if (original.version !== input.expectedVersion || original.status !== current.status) throw fail('ABSENCE_VERSION_CONFLICT', 'A solicitação foi alterada. Atualize e tente novamente.');
    if (input.action === 'cancel' && original.status === 'approved' && original.input.startDate <= belemCivilDate(new Date())) {
      throw fail('ABSENCE_CANCEL_NOT_FUTURE', 'Cancelamento aprovado disponível somente antes do início.');
    }
    const typeDoc = input.action === 'submit' || input.action === 'update_draft'
      ? await tx.get(hrDbAdmin.collection('dp_absenceTypes').doc(input.action === 'update_draft' ? input.request.absenceTypeId : original.typeId)) : null;
    if (input.action === 'submit' && (!typeDoc?.exists || typeDoc.get('status') !== 'published' || typeDoc.get('version') !== original.typeVersion)) {
      throw fail('ABSENCE_RULE_CHANGED', 'A regra mudou. Crie uma nova solicitação.');
    }
    if (input.action === 'submit') {
      if (!target) throw fail('ABSENCE_PROFILE_UNAVAILABLE', 'Vínculo ou lotação indisponível para solicitação.');
      try {
        const freshType = { id: typeDoc!.id, ...typeDoc!.data() } as DPAbsenceType;
        const preview = previewAbsenceRequest(original.input, freshType, target, belemCivilDate(new Date()), 'coala-rh', original.origin ?? 'collaborator');
        if (preview.rule.id !== original.policyId || preview.quantity.value !== original.quantity) throw fail('ABSENCE_RULE_CHANGED', 'A regra mudou. Crie uma nova solicitação.');
        const freshPolicy = freshType.policies.find((candidate) => candidate.id === preview.rule.id);
        if (!freshPolicy || snapshotHash(freshPolicy) !== snapshotHash(original.policySnapshot)
          || freshType.workdayEffect !== original.typeSnapshot.workdayEffect
          || freshType.blocksSchedule !== original.typeSnapshot.blocksSchedule
          || freshType.includeInAbsenteeism !== original.typeSnapshot.includeInAbsenteeism) {
          throw fail('ABSENCE_RULE_CHANGED', 'A regra mudou. Crie uma nova solicitação.');
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw fail('ABSENCE_RULE_CHANGED', 'A regra ou prazo mudou. Crie uma nova solicitação.');
      }
    }
    const prepared = prepRef ? await tx.get(prepRef) : null;
    if (input.action === 'update_draft' && prepRef && (!prepared?.exists || prepared.get('status') !== 'prepared'
      || prepared.get('parentRequestId') !== original.id || prepared.get('workspaceId') !== actor.workspace_id
      || prepared.get('ownerUid') !== actor.decoded.uid || prepared.get('beneficiaryUid') !== original.beneficiaryUid
      || String(prepared.get('expiresAt')) <= nowIso())) throw fail('ABSENCE_PREPARATION_UNAVAILABLE', 'Comprovantes indisponíveis.');
    const reservation = ['submit', 'approve', 'reject', 'request_adjustments', 'cancel'].includes(input.action)
      && (input.action === 'submit' || original.status === 'in_review' || original.status === 'approved')
      ? await readReservationState(tx, original) : null;
    const occurrenceDoc = finalApproval || input.action === 'cancel' && original.status === 'approved'
      ? await tx.get(occurrences.doc(original.id)) : null;
    const operationalIntentDoc = operationalIntent ? await tx.get(operationalIntentRef(original.id, original.version)) : null;
    if (operationalIntent && (!operationalIntentDoc?.exists || operationalIntentDoc.get('status') !== 'prepared'
      || operationalIntentDoc.get('fenceId') !== operationalIntent.fenceId
      || operationalIntentDoc.get('revision') !== original.revision
      || operationalIntentDoc.get('actorUid') !== actor.decoded.uid
      || operationalIntentDoc.get('operationId') !== input.operationId
      || operationalIntentDoc.get('actionHash') !== operationHash(input)
      || operationalIntentDoc.get('epoch') !== operationalEpoch
      || operationalIntentDoc.get('beneficiaryUid') !== original.beneficiaryUid
      || operationalIntentDoc.get('unitId') !== original.unitId
      || operationalIntentDoc.get('blocksSchedule') !== (original.typeSnapshot.blocksSchedule === true)
      || JSON.stringify(operationalIntentDoc.get('segments')) !== JSON.stringify(operationalIntent.segments))) {
      throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED', 'Preparo operacional mudou. Atualize e tente novamente.');
    }
    const reversalIntentDoc = reversalIntent ? await tx.get(operationalIntentRef(reversalIntent.requestId, reversalIntent.expectedVersion)) : null;
    if (reversalIntent && (!reversalIntentDoc?.exists || reversalIntentDoc.get('fenceId') !== reversalIntent.fenceId
      || !['committed', 'active'].includes(String(reversalIntentDoc.get('status')))
      || original.operationalFence?.fenceId !== reversalIntent.fenceId)) {
      throw fail('ABSENCE_OPERATIONAL_INTENT_CHANGED', 'Projeção operacional indisponível.');
    }
    const timestamp = nowIso();
    const value: AbsenceRequestRecord = { ...original, version: original.version + 1, updatedAt: timestamp,
      lastOperationId: input.operationId, lastOperationActorUid: actor.decoded.uid,
      lastOperationAction: input.action, lastOperationHash: operationHash(input),
      history: [...original.history, { action: tacit ? 'tacit_approve' : input.action, actorUid: actor.decoded.uid,
        at: timestamp, ...('reason' in input && input.reason ? { reason: input.reason } : {}), version: original.version + 1 }] };
    if (input.action === 'update_draft') {
      if (!target?.unitId || !typeDoc?.exists) throw fail('ABSENCE_REQUEST_UNAVAILABLE', 'Tipo ou vínculo indisponível.');
      const type = { id: typeDoc.id, ...typeDoc.data() } as DPAbsenceType;
      let preview;
      try { preview = previewAbsenceRequest(input.request, type, target, belemCivilDate(new Date()), 'coala-rh', original.origin ?? 'collaborator'); }
      catch { throw fail('ABSENCE_REQUEST_UNAVAILABLE', 'Tipo ou período indisponível para solicitação.', 'VALIDATION'); }
      if (preview.quantity.value === null) throw fail('ABSENCE_QUANTITY_UNAVAILABLE', 'Jornada ainda não disponível.');
      const policy = type.policies.find((candidate) => candidate.id === preview.rule.id)!;
      const attachments = [...original.attachments, ...newFiles];
      if (attachments.length > 5) throw fail('ABSENCE_FILE_LIMIT', 'São permitidos até cinco arquivos.', 'VALIDATION');
      if (preview.attachmentRequired && !attachments.length) throw fail('ABSENCE_DOCUMENT_REQUIRED', 'Anexe o documento exigido.', 'VALIDATION');
      const custodian = attachments.length || policy.allowFutureCancel || ['dp', 'manager_then_dp'].includes(policy.approvalFlow)
        ? await resolveAbsenceApprovers(policy, 'dp', original.beneficiaryUid, target.unitId) : null;
      value.status = 'draft'; value.revision += 1; value.input = input.request;
      if (input.reason) value.reason = input.reason; else delete value.reason;
      delete value.reviewSla;
      value.startDate = input.request.startDate; value.endDate = input.request.endDate;
      value.quantity = preview.quantity.value; value.unit = input.request.unit; value.unitId = target.unitId;
      value.beneficiaryName = typeof resolvedSubmit?.beneficiary.username === 'string'
        ? resolvedSubmit.beneficiary.username.slice(0, 120) : value.beneficiaryName ?? null;
      value.typeId = type.id; value.lineageId = type.lineageId; value.typeVersion = type.version;
      value.typeSnapshot = { name: type.name, workdayEffect: type.workdayEffect, blocksSchedule: type.blocksSchedule,
        includeInAbsenteeism: type.includeInAbsenteeism, validFrom: type.validFrom,
        ...(type.validTo ? { validTo: type.validTo } : {}) };
      value.policyId = policy.id; value.policySnapshot = structuredClone(policy);
      value.profileFingerprint = fingerprint(target); value.profileReviewRequired = false;
      delete value.profileReviewConfirmedBy; delete value.profileReviewConfirmedFingerprint;
      delete value.profileReviewConfirmedRevision; delete value.profileReviewReason;
      value.segments = absenceDaySegments(input.request, policy);
      value.attachments = attachments; value.custodianDpUid = custodian?.reviewerIds[0] ?? null;
      projectAbsenceRetentionCases(tx, value, newFiles);
      tx.create(revisions.doc(`${original.id}_${original.version}`), { requestId: original.id, workspaceId: original.workspaceId,
        previousVersion: original.version, previousRevision: original.revision, input: original.input,
        typeSnapshot: original.typeSnapshot, policySnapshot: original.policySnapshot, attachments: original.attachments,
        quantity: original.quantity, unit: original.unit, actorUid: actor.decoded.uid, at: timestamp });
      if (prepRef) tx.update(prepRef, { status: 'claimed', requestId: original.id, claimedAt: timestamp });
    } else if (input.action === 'submit') {
      value.profileReviewRequired = !target || fingerprint(target) !== original.profileFingerprint
        || original.input.startDate < belemCivilDate(new Date());
      if (!assignment && value.profileReviewRequired) throw fail('ABSENCE_PROFILE_CONFIRMATION_REQUIRED', 'Confirmação de DP necessária antes da aprovação automática.');
      if (original.policySnapshot.attachment === 'required' && !original.attachments.length) throw fail('ABSENCE_DOCUMENT_REQUIRED', 'Documento exigido indisponível.', 'VALIDATION');
      value.status = assignment ? 'in_review' : 'approved';
      value.stage = assignment?.stage ?? null; value.stageIndex = assignment?.level ?? -1;
      value.assignedReviewerIds = assignment?.reviewerIds ?? []; value.submittedAt = timestamp;
      if (assignment) value.reviewSla = createAbsenceReviewSla(timestamp);
      else delete value.reviewSla;
      if (original.status === 'adjustments_requested') value.revision += 1;
      delete value.profileReviewConfirmedBy;
      delete value.profileReviewConfirmedFingerprint;
      delete value.profileReviewConfirmedRevision;
      delete value.profileReviewReason;
      if (reservation) reserve(tx, original, reservation, assignment ? 'add' : 'approve_add');
    } else if (input.action === 'approve') {
      if (tacit) value.tacitApprovals = [...(original.tacitApprovals ?? []), { stage: original.stage ?? 'dp', at: timestamp, days: tacit.days }];
      value.profileReviewRequired = original.profileReviewRequired || profileDrift;
      if (input.confirmProfile) {
        value.profileReviewConfirmedBy = actor.decoded.uid; value.profileReviewReason = input.profileReason;
        value.profileReviewConfirmedFingerprint = liveFingerprint!; value.profileReviewConfirmedRevision = original.revision;
      }
      if (assignment) {
        value.stage = assignment.stage; value.stageIndex = assignment.level;
        value.assignedReviewerIds = assignment.reviewerIds;
        value.reviewSla = createAbsenceReviewSla(timestamp);
      }
      else {
        if (value.profileReviewRequired && (!value.profileReviewConfirmedBy
          || value.profileReviewConfirmedFingerprint !== liveFingerprint || value.profileReviewConfirmedRevision !== original.revision)) {
          throw fail('ABSENCE_PROFILE_CONFIRMATION_REQUIRED', 'O DP deve confirmar o histórico/perfil antes da aprovação final.');
        }
        value.status = 'approved'; value.stage = null; value.stageIndex = -1; value.assignedReviewerIds = []; value.decidedAt = timestamp;
        value.approvalOrigin = tacit ? 'tacit_timeout' : 'review';
        delete value.reviewSla;
        if (reservation) reserve(tx, original, reservation, 'consume');
      }
    } else if (input.action === 'confirm_profile') {
      value.profileReviewRequired = true;
      value.profileReviewConfirmedBy = actor.decoded.uid; value.profileReviewReason = input.reason;
      value.profileReviewConfirmedFingerprint = liveFingerprint!; value.profileReviewConfirmedRevision = original.revision;
    } else if (input.action === 'reject' || input.action === 'request_adjustments') {
      value.status = input.action === 'reject' ? 'rejected' : 'adjustments_requested';
      value.stage = null; value.stageIndex = -1; value.assignedReviewerIds = [];
      delete value.reviewSla;
      if (reservation) reserve(tx, original, reservation, 'release');
      if (input.action === 'reject') value.decidedAt = timestamp;
    } else if (input.action === 'cancel') {
      value.status = 'cancelled'; value.stage = null; value.stageIndex = -1; value.assignedReviewerIds = []; value.decidedAt = timestamp;
      delete value.reviewSla;
      if (reversalIntent && value.operationalFence) value.operationalFence = { ...value.operationalFence, state: 'reversal_pending' };
      if (reservation) reserve(tx, original, reservation, 'release');
    }
    if (operationalIntent && value.status === 'approved') {
      delete value.operationalPending;
      value.operationalFence = { fenceId: operationalIntent.fenceId,
        requestVersion: value.version, epoch: operationalEpoch!, state: 'activation_pending' };
    }
    tx.set(requests.doc(requestId), value);
    if (value.status === 'approved' && original.status !== 'approved') {
      if (occurrenceDoc?.exists) throw fail('ABSENCE_OCCURRENCE_CONFLICT', 'Ocorrência já registrada.');
      tx.create(occurrences.doc(value.id), { requestId: value.id, workspaceId: value.workspaceId, beneficiaryUid: value.beneficiaryUid,
        unitId: value.unitId, input: value.input, quantity: value.quantity, unit: value.unit, typeId: value.typeId,
        typeVersion: value.typeVersion, policyId: value.policyId, typeSnapshot: value.typeSnapshot, policySnapshot: value.policySnapshot,
        requestVersion: value.version, revision: value.revision, segments: value.segments,
        status: 'approved', projectionStatus: 'pending', createdAt: timestamp });
      queue(tx, value, `${value.id}_${value.version}_projection`, 'projection_pending', []);
      if (operationalIntent) {
        tx.update(operationalIntentRef(value.id, original.version), { status: 'committed', committedAt: timestamp });
        queue(tx, value, `${value.id}_${value.version}_operational`, 'operational_activation_pending', []);
      }
    }
    if (input.action === 'cancel' && original.status === 'approved') {
      if (!occurrenceDoc?.exists) throw fail('ABSENCE_OCCURRENCE_MISSING', 'Ocorrência não encontrada.');
      tx.create(reversals.doc(`${value.id}_${value.version}`), { requestId: value.id, occurrenceId: value.id,
        workspaceId: value.workspaceId, beneficiaryUid: value.beneficiaryUid, originalVersion: original.version,
        reversalVersion: value.version, actorUid: actor.decoded.uid, reason: input.reason, createdAt: timestamp,
        originalSegments: original.segments, originalQuantity: original.quantity, originalUnit: original.unit });
      tx.update(occurrences.doc(value.id), { reversalStatus: 'pending', reversalRequestedAt: timestamp });
      queue(tx, value, `${value.id}_${value.version}_projection`, 'projection_reversal_pending', []);
      if (reversalIntent) queue(tx, value, `${value.id}_${value.version}_operational`, 'operational_reversal_pending', []);
    }
    const recipients = value.status === 'in_review' ? value.assignedReviewerIds : [value.beneficiaryUid];
    if (input.action !== 'update_draft') queue(tx, value, `${value.id}_${value.version}_notification`, `notification_${input.action}`, recipients);
    audit(tx, value, actor.decoded.uid, tacit ? 'tacit_approve' : input.action, input.operationId);
    return value;
  });
  if (operationalIntent && result.status === 'approved') {
    // A failed/unknown Coala commit leaves prepared markers blocking writers; the outbox stays pending.
    await activateOperationalAbsence(operationalIntent)
      .then(() => acknowledgeOperationalActivation(operationalIntent))
      .catch(() => undefined);
  }
  if (reversalIntent && result.status === 'cancelled') {
    await reverseOperationalAbsence(reversalIntent)
      .then(() => acknowledgeOperationalReversal(reversalIntent, result.version, actor.decoded.uid))
      .catch(() => undefined);
  }
  if (input.action !== 'update_draft') await dispatchAbsenceNotification(result.id, result.version).catch(() => undefined);
  return dto(result, actor);
}
