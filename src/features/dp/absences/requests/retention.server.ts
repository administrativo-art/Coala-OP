import 'server-only';

import { createHash } from 'node:crypto';
import { FieldPath, FieldValue, type Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { absenceFileStore, terminationCivilDate, type AbsenceFileStore } from './files.server';
import { storedEmploymentCycleVersion } from '@/lib/employment-cycle.server';
import { belemCivilDate } from './core';
import type { AbsenceAttachment, AbsenceRequestRecord } from './workflow-types';

export type AbsenceRetentionState = 'unanchored' | 'scheduled' | 'awaiting_authorization' | 'authorized'
  | 'retained_until_review' | 'needs_revalidation' | 'execution_blocked' | 'preparing_execution'
  | 'executing' | 'execution_unknown' | 'release_pending' | 'execution_review_required' | 'removed';
type AbsenceRetentionExecution = {
  operationId: string; actorUid: string; startedAt: string; updatedAt: string;
  target: { bucket: string; storagePath: string; generation: string; sha256: string };
};
export type AbsenceRetentionCase = {
  workspaceId: string; requestId: string; fileId: string; beneficiaryUid: string; unitId: string;
  custodianUid: string | null; state: AbsenceRetentionState; version: number;
  terminationDate: string | null; terminationSourceVersion: number | null;
  terminationSourceDocumentVersion: number | null; terminationSessionVersion: number | null;
  employmentCycleVersion?: number | null;
  reviewAfter: string | null;
  noticeStatus: 'none' | 'pending' | 'sent'; decision?: { action: 'authorize_delete' | 'retain';
    actorUid: string; reason: string; at: string; nextReviewAfter?: string };
  createdAt: string; updatedAt: string;
  execution?: AbsenceRetentionExecution;
};
const cases = hrDbAdmin.collection('dp_absenceRetentionCases');
const operations = hrDbAdmin.collection('dp_absenceRetentionOperations');
const executionReceipts = hrDbAdmin.collection('dp_absenceRetentionExecutionReceipts');
const audit = hrDbAdmin.collection('dp_absenceRetentionAudit');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const deny = () => new AppError({ code: 'ABSENCE_RETENTION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Caso de retenção indisponível.' });
const invalid = () => new AppError({ code: 'ABSENCE_RETENTION_INVALID', kind: 'VALIDATION', safeMessage: 'Dados de retenção inválidos.' });
export const absenceRetentionCaseId = (requestId: string, fileId: string) => `${requestId}_${fileId}`;

/** Called inside the same RH transaction that claims attachment preparation; no Storage operation here. */
export function projectAbsenceRetentionCases(tx: Transaction, request: AbsenceRequestRecord, files: AbsenceAttachment[]) {
  if (!request.attachments.length) return;
  const now = new Date().toISOString();
  // Recheck the beneficiary after claim: a termination may race across Coala/RH after preparation.
  tx.set(hrDbAdmin.collection('dp_absenceRetentionReconciliations')
    .doc(hash(`${request.workspaceId}:${request.beneficiaryUid}`)), {
    workspaceId: request.workspaceId, beneficiaryUid: request.beneficiaryUid,
    sourceKey: null, state: 'pending', cursor: null, updatedAt: now });
  if (!files.length) return;
  for (const file of files) {
    const value: AbsenceRetentionCase = { workspaceId: request.workspaceId, requestId: request.id, fileId: file.id,
      beneficiaryUid: request.beneficiaryUid, unitId: request.unitId, custodianUid: request.custodianDpUid,
      state: request.custodianDpUid ? 'unanchored' : 'needs_revalidation', version: 1,
      terminationDate: null, terminationSourceVersion: null, terminationSourceDocumentVersion: null,
      terminationSessionVersion: null, employmentCycleVersion: null,
      reviewAfter: null, noticeStatus: 'none', createdAt: now, updatedAt: now };
    tx.create(cases.doc(absenceRetentionCaseId(request.id, file.id)), value);
    tx.create(audit.doc(`project_${request.id}_${file.id}`), { workspaceId: request.workspaceId, requestId: request.id,
      fileId: file.id, beneficiaryUid: request.beneficiaryUid, action: 'projected', at: now });
  }
}

function requireReviewer(actor: ServerUserContext, unitId: string) {
  if ((!actor.isDefaultAdmin && actor.permissions.dp.requests.review !== true)
    || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw deny();
}
function publicCase(id: string, value: AbsenceRetentionCase) {
  return { id, requestId: value.requestId, fileId: value.fileId, beneficiaryUid: value.beneficiaryUid,
    unitId: value.unitId, state: value.state, version: value.version, reviewAfter: value.reviewAfter,
    custodianUid: value.custodianUid, decision: value.decision ?? null, updatedAt: value.updatedAt };
}
export async function listAbsenceRetentionCases(actor: ServerUserContext, input: {
  unitId: string; state?: AbsenceRetentionState; limit: number; cursor?: string;
}) {
  requireReviewer(actor, input.unitId);
  let query: FirebaseFirestore.Query = cases.where('workspaceId', '==', actor.workspace_id)
    .where('unitId', '==', input.unitId);
  if (input.state) query = query.where('state', '==', input.state);
  query = query.orderBy('updatedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (input.cursor) {
    const cursor = await cases.doc(input.cursor).get();
    if (!cursor.exists || cursor.get('workspaceId') !== actor.workspace_id || cursor.get('unitId') !== input.unitId
      || input.state && cursor.get('state') !== input.state) throw deny();
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(input.limit + 1).get();
  return { cases: snapshot.docs.slice(0, input.limit).map((document) => publicCase(document.id, document.data() as AbsenceRetentionCase)),
    nextCursor: snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : null };
}

export async function decideAbsenceRetention(actor: ServerUserContext, caseId: string, input: {
  action: 'authorize_delete' | 'retain'; reason: string; nextReviewAfter?: string;
  expectedVersion: number; operationId: string;
}) {
  const ref = cases.doc(caseId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.get('workspaceId') !== actor.workspace_id) throw deny();
  const initial = snapshot.data() as AbsenceRetentionCase;
  requireReviewer(actor, initial.unitId);
  if (initial.custodianUid !== actor.decoded.uid || actor.decoded.uid === initial.beneficiaryUid) throw deny();
  const beneficiary = await dbAdmin.collection('users').doc(initial.beneficiaryUid).get();
  const currentDate = beneficiary.exists ? terminationCivilDate(beneficiary.get('terminationDate')) : null;
  const anchored = beneficiary.exists && beneficiary.get('isActive') === false
    && currentDate === initial.terminationDate && currentDate !== null
    && Number.isSafeInteger(initial.terminationSessionVersion)
    && beneficiary.get('sessionVersion') === initial.terminationSessionVersion
    && storedEmploymentCycleVersion(beneficiary.get('employmentCycleVersion'))
      === storedEmploymentCycleVersion(initial.employmentCycleVersion);
  const digest = hash(JSON.stringify([caseId, actor.decoded.uid, input]));
  const receiptRef = operations.doc(hash(`${caseId}:${input.operationId}`));
  return hrDbAdmin.runTransaction(async (tx) => {
    const [current, receipt, request] = await Promise.all([tx.get(ref), tx.get(receiptRef),
      tx.get(hrDbAdmin.collection('dp_absenceRequests').doc(initial.requestId))]);
    const requestAttachments = request.exists ? request.get('attachments') : null;
    const requestAttachment = Array.isArray(requestAttachments)
      ? requestAttachments.find((attachment: { id?: unknown }) => attachment.id === initial.fileId) : null;
    if (!current.exists || current.get('workspaceId') !== actor.workspace_id || !request.exists
      || request.get('workspaceId') !== actor.workspace_id || request.get('custodianDpUid') !== actor.decoded.uid
      || current.get('custodianUid') !== actor.decoded.uid || current.get('unitId') !== request.get('unitId')
      || current.get('requestId') !== initial.requestId || current.get('fileId') !== initial.fileId
      || current.get('beneficiaryUid') !== initial.beneficiaryUid || !requestAttachment || requestAttachment.deletion
      || ['draft', 'in_review'].includes(String(request.get('status')))) throw deny();
    if (receipt.exists) {
      if (receipt.get('digest') !== digest || receipt.get('actorUid') !== actor.decoded.uid) throw invalid();
      return { ...publicCase(current.id, current.data() as AbsenceRetentionCase), replayed: true };
    }
    if (current.get('version') !== input.expectedVersion
      || !['awaiting_authorization', 'needs_revalidation'].includes(String(current.get('state')))) {
      throw new AppError({ code: 'ABSENCE_RETENTION_VERSION_CONFLICT', kind: 'CONFLICT', safeMessage: 'Caso alterado. Atualize antes de decidir.' });
    }
    if (input.action === 'authorize_delete' && (!current.get('reviewAfter')
      || current.get('reviewAfter') > belemCivilDate(new Date()))) throw invalid();
    if (!anchored || current.get('terminationDate') !== initial.terminationDate
      || current.get('terminationSessionVersion') !== initial.terminationSessionVersion) {
      const now = new Date().toISOString();
      tx.update(ref, { state: 'needs_revalidation', version: input.expectedVersion + 1, updatedAt: now });
      tx.create(audit.doc(`${caseId}_${input.expectedVersion + 1}`), { workspaceId: actor.workspace_id,
        requestId: initial.requestId, fileId: initial.fileId, beneficiaryUid: initial.beneficiaryUid,
        actorUid: actor.decoded.uid, action: 'revalidation_required', at: now });
      tx.create(receiptRef, { caseId, operationId: input.operationId, actorUid: actor.decoded.uid,
        digest, at: now, resultingVersion: input.expectedVersion + 1, resultingState: 'needs_revalidation' });
      return { ...publicCase(current.id, current.data() as AbsenceRetentionCase), state: 'needs_revalidation' as const,
        version: input.expectedVersion + 1, replayed: false };
    }
    const now = new Date().toISOString();
    const decision = { action: input.action, actorUid: actor.decoded.uid, reason: input.reason, at: now,
      ...(input.nextReviewAfter ? { nextReviewAfter: input.nextReviewAfter } : {}) };
    const nextState = input.action === 'retain' ? 'retained_until_review' : 'authorized';
    tx.update(ref, { state: nextState, version: input.expectedVersion + 1, decision,
      ...(input.nextReviewAfter ? { reviewAfter: input.nextReviewAfter, noticeStatus: 'none' } : {}), updatedAt: now });
    tx.create(receiptRef, { caseId, operationId: input.operationId, actorUid: actor.decoded.uid,
      digest, at: now, resultingVersion: input.expectedVersion + 1 });
    tx.create(audit.doc(`${caseId}_${input.expectedVersion + 1}`), { workspaceId: actor.workspace_id,
      requestId: initial.requestId, fileId: initial.fileId, beneficiaryUid: initial.beneficiaryUid,
      actorUid: actor.decoded.uid, action: input.action, reason: input.reason, at: now,
      ...(input.nextReviewAfter ? { nextReviewAfter: input.nextReviewAfter } : {}) });
    return { ...publicCase(current.id, current.data() as AbsenceRetentionCase), state: nextState,
      version: input.expectedVersion + 1, decision, replayed: false };
  });
}

/** Executes only the authorized Storage generation behind the employment-cycle fence. */
export async function executeAbsenceRetention(actor: ServerUserContext, caseId: string,
  expectedVersion: number, operationId: string, store: AbsenceFileStore = absenceFileStore) {
  const ref = cases.doc(caseId);
  const source = await ref.get();
  if (!source.exists || source.get('workspaceId') !== actor.workspace_id) throw deny();
  requireReviewer(actor, source.get('unitId'));
  if (source.get('custodianUid') !== actor.decoded.uid || source.get('beneficiaryUid') === actor.decoded.uid) throw deny();
  const digest = hash(JSON.stringify([caseId, actor.decoded.uid, expectedVersion, operationId]));
  const receiptRef = executionReceipts.doc(hash(`${caseId}:${operationId}`));
  const claimed = await hrDbAdmin.runTransaction(async (tx) => {
    const [current, request, receipt] = await Promise.all([tx.get(ref),
      tx.get(hrDbAdmin.collection('dp_absenceRequests').doc(source.get('requestId'))), tx.get(receiptRef)]);
    if (receipt.exists) {
      if (receipt.get('digest') !== digest || receipt.get('actorUid') !== actor.decoded.uid) throw invalid();
      return { completed: receipt.get('state') === 'removed' };
    }
    if (!current.exists || !request.exists || current.get('workspaceId') !== actor.workspace_id
      || request.get('workspaceId') !== actor.workspace_id || current.get('custodianUid') !== actor.decoded.uid
      || request.get('custodianDpUid') !== actor.decoded.uid) throw deny();
    const existingExecution = current.get('execution') as AbsenceRetentionExecution | undefined;
    if (existingExecution?.operationId === operationId
      && ['preparing_execution', 'executing', 'execution_unknown', 'release_pending'].includes(current.get('state'))) {
      return { completed: false };
    }
    if (current.get('version') !== expectedVersion || current.get('state') !== 'authorized') {
      throw new AppError({ code: 'ABSENCE_RETENTION_VERSION_CONFLICT', kind: 'CONFLICT',
        safeMessage: 'Caso alterado. Atualize antes de executar.' });
    }
    const attachments = request.get('attachments');
    const attachment = Array.isArray(attachments)
      ? attachments.find((file: { id?: unknown }) => file.id === current.get('fileId')) as AbsenceAttachment | undefined : undefined;
    if (!attachment || attachment.deletion || !attachment.storagePath || !attachment.generation || !attachment.sha256) throw deny();
    const now = new Date().toISOString();
    const execution: AbsenceRetentionExecution = { operationId, actorUid: actor.decoded.uid, startedAt: now, updatedAt: now,
      target: { bucket: store.bucketName, storagePath: attachment.storagePath,
        generation: attachment.generation, sha256: attachment.sha256 } };
    tx.update(ref, { state: 'preparing_execution', version: expectedVersion + 1, execution, updatedAt: now });
    tx.create(audit.doc(`${caseId}_${expectedVersion + 1}`), { workspaceId: actor.workspace_id,
      requestId: current.get('requestId'), fileId: current.get('fileId'), beneficiaryUid: current.get('beneficiaryUid'),
      actorUid: actor.decoded.uid, operationId, action: 'execution_prepared', at: now });
    tx.create(receiptRef, { caseId, operationId, actorUid: actor.decoded.uid, digest, state: 'executing',
      target: execution.target, startedAt: now, updatedAt: now });
    return { completed: false };
  });
  if (claimed.completed) {
    const current = await ref.get();
    return { ...publicCase(current.id, current.data() as AbsenceRetentionCase), replayed: true };
  }
  const result = await reconcileAbsenceRetentionExecution(caseId, store);
  return { ...result, replayed: false };
}

function executionMatchesFence(fence: unknown, value: AbsenceRetentionCase) {
  if (!fence || typeof fence !== 'object' || !value.execution) return false;
  const record = fence as Record<string, unknown>;
  return record.caseId === absenceRetentionCaseId(value.requestId, value.fileId)
    && record.operationId === value.execution.operationId;
}

async function acquireExecutionFence(ref: FirebaseFirestore.DocumentReference, value: AbsenceRetentionCase) {
  if (!value.execution) throw invalid();
  const userRef = dbAdmin.collection('users').doc(value.beneficiaryUid);
  const now = new Date().toISOString();
  try {
    await dbAdmin.runTransaction(async (tx) => {
      const user = await tx.get(userRef);
      const date = user.exists ? terminationCivilDate(user.get('terminationDate')) : null;
      const cycleVersion = user.exists ? storedEmploymentCycleVersion(user.get('employmentCycleVersion')) : -1;
      const existingFence = user.get('absenceDocumentDeletionFence');
      if (existingFence && !executionMatchesFence(existingFence, value)) {
        throw new AppError({ code: 'ABSENCE_RETENTION_EMPLOYMENT_FENCE_BUSY', kind: 'CONFLICT',
          safeMessage: 'Outra exclusão documental está em andamento para esta pessoa.' });
      }
      if (!user.exists || user.get('isActive') !== false || !date || date !== value.terminationDate
        || cycleVersion !== storedEmploymentCycleVersion(value.employmentCycleVersion)
        || user.get('sessionVersion') !== value.terminationSessionVersion) {
        throw new AppError({ code: 'ABSENCE_RETENTION_EMPLOYMENT_CHANGED', kind: 'CONFLICT',
          safeMessage: 'O vínculo foi alterado e precisa ser revisado antes da exclusão.' });
      }
      tx.set(userRef, { absenceDocumentDeletionFence: { protocolVersion: 1, workspaceId: value.workspaceId,
        caseId: ref.id, operationId: value.execution!.operationId, state: 'executing',
        employmentCycleVersion: cycleVersion, terminationDate: date,
        startedAt: value.execution!.startedAt, updatedAt: now } }, { merge: true });
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'ABSENCE_RETENTION_EMPLOYMENT_CHANGED') {
      await hrDbAdmin.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (!current.exists || current.get('state') !== 'preparing_execution'
          || current.get('execution.operationId') !== value.execution?.operationId) return;
        const version = Number(current.get('version')) + 1;
        tx.update(ref, { state: 'needs_revalidation', version, updatedAt: now });
        tx.create(audit.doc(`${ref.id}_${version}`), { workspaceId: value.workspaceId, requestId: value.requestId,
          fileId: value.fileId, beneficiaryUid: value.beneficiaryUid, actorUid: value.execution?.actorUid,
          operationId: value.execution?.operationId, action: 'execution_anchor_changed', at: now });
      });
    }
    throw error;
  }
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get('execution.operationId') !== value.execution?.operationId) throw invalid();
    if (current.get('state') === 'preparing_execution') tx.update(ref, { state: 'executing',
      version: Number(current.get('version')) + 1, 'execution.updatedAt': now, updatedAt: now });
  });
}

async function setExecutionProblem(ref: FirebaseFirestore.DocumentReference, value: AbsenceRetentionCase,
  state: 'execution_unknown' | 'execution_review_required', action: string) {
  if (!value.execution) throw invalid();
  const now = new Date().toISOString();
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get('execution.operationId') !== value.execution?.operationId
      || current.get('state') === 'removed') return;
    const version = Number(current.get('version')) + 1;
    tx.update(ref, { state, version, 'execution.updatedAt': now, updatedAt: now });
    tx.set(audit.doc(`${ref.id}_${version}`), { workspaceId: value.workspaceId, requestId: value.requestId,
      fileId: value.fileId, beneficiaryUid: value.beneficiaryUid, actorUid: value.execution?.actorUid,
      operationId: value.execution?.operationId, action, at: now });
  });
  await dbAdmin.runTransaction(async (tx) => {
    const userRef = dbAdmin.collection('users').doc(value.beneficiaryUid);
    const user = await tx.get(userRef);
    if (user.exists && executionMatchesFence(user.get('absenceDocumentDeletionFence'), value)) {
      tx.update(userRef, { 'absenceDocumentDeletionFence.state': state === 'execution_unknown'
        ? 'execution_unknown' : 'review_required', 'absenceDocumentDeletionFence.updatedAt': now });
    }
  });
}

async function finalizeRemovedBytes(ref: FirebaseFirestore.DocumentReference, value: AbsenceRetentionCase) {
  if (!value.execution) throw invalid();
  const requestRef = hrDbAdmin.collection('dp_absenceRequests').doc(value.requestId);
  const receiptRef = executionReceipts.doc(hash(`${ref.id}:${value.execution.operationId}`));
  const now = new Date().toISOString();
  await hrDbAdmin.runTransaction(async (tx) => {
    const [current, request, receipt] = await Promise.all([tx.get(ref), tx.get(requestRef), tx.get(receiptRef)]);
    if (!current.exists || !request.exists || current.get('execution.operationId') !== value.execution?.operationId) throw invalid();
    if (current.get('state') === 'release_pending' || current.get('state') === 'removed') return;
    const attachments = request.get('attachments');
    const index = Array.isArray(attachments) ? attachments.findIndex((file: { id?: unknown }) => file.id === value.fileId) : -1;
    const attachment = index >= 0 ? attachments[index] as AbsenceAttachment : null;
    if (!attachment || attachment.storagePath !== value.execution?.target.storagePath
      || attachment.generation !== value.execution?.target.generation || attachment.sha256 !== value.execution?.target.sha256) {
      throw new AppError({ code: 'ABSENCE_RETENTION_ATTACHMENT_CHANGED', kind: 'CONFLICT',
        safeMessage: 'O documento mudou e exige revisão humana.' });
    }
    const nextAttachments = [...attachments];
    nextAttachments[index] = { ...attachment, deletion: { state: 'removed', requestedAt: value.execution.startedAt,
      completedAt: now, actorUid: value.execution.actorUid,
      reason: current.get('decision.reason') ?? 'Exclusão autorizada após retenção.' } };
    const version = Number(current.get('version')) + 1;
    tx.update(requestRef, { attachments: nextAttachments, updatedAt: now });
    tx.update(ref, { state: 'release_pending', version, 'execution.updatedAt': now, updatedAt: now });
    tx.set(receiptRef, { state: 'release_pending', removedAt: now, updatedAt: now }, { merge: true });
    tx.set(audit.doc(`${ref.id}_${version}`), { workspaceId: value.workspaceId, requestId: value.requestId,
      fileId: value.fileId, beneficiaryUid: value.beneficiaryUid, actorUid: value.execution?.actorUid,
      operationId: value.execution?.operationId, action: 'storage_generation_removed', at: now });
    void receipt;
  });
}

async function releaseExecutionFence(ref: FirebaseFirestore.DocumentReference, value: AbsenceRetentionCase) {
  if (!value.execution) throw invalid();
  const userRef = dbAdmin.collection('users').doc(value.beneficiaryUid);
  await dbAdmin.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw invalid();
    const fence = user.get('absenceDocumentDeletionFence');
    if (!fence) return;
    if (!executionMatchesFence(fence, value)) throw new AppError({ code: 'ABSENCE_RETENTION_FENCE_CHANGED', kind: 'CONFLICT',
      safeMessage: 'A trava do vínculo mudou e exige revisão humana.' });
    tx.update(userRef, { absenceDocumentDeletionFence: FieldValue.delete() });
  });
  const now = new Date().toISOString();
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get('execution.operationId') !== value.execution?.operationId) throw invalid();
    if (current.get('state') === 'removed') return;
    if (current.get('state') !== 'release_pending') throw invalid();
    const version = Number(current.get('version')) + 1;
    tx.update(ref, { state: 'removed', version, 'execution.updatedAt': now, updatedAt: now });
    tx.set(executionReceipts.doc(hash(`${ref.id}:${value.execution?.operationId}`)),
      { state: 'removed', completedAt: now, updatedAt: now }, { merge: true });
    tx.set(audit.doc(`${ref.id}_${version}`), { workspaceId: value.workspaceId, requestId: value.requestId,
      fileId: value.fileId, beneficiaryUid: value.beneficiaryUid, actorUid: value.execution?.actorUid,
      operationId: value.execution?.operationId, action: 'execution_completed', at: now });
  });
}

/** Reconciles one case without assuming a transaction between Firestore databases and Storage. */
export async function reconcileAbsenceRetentionExecution(caseId: string, store: AbsenceFileStore = absenceFileStore) {
  const ref = cases.doc(caseId);
  let snapshot = await ref.get();
  if (!snapshot.exists) throw deny();
  let value = snapshot.data() as AbsenceRetentionCase;
  if (!value.execution) throw invalid();
  let execution = value.execution;
  if (value.state === 'removed') return publicCase(snapshot.id, value);
  if (value.state === 'preparing_execution') {
    await acquireExecutionFence(ref, value);
    snapshot = await ref.get(); value = snapshot.data() as AbsenceRetentionCase;
    if (!value.execution) throw invalid();
    execution = value.execution;
  }
  if (value.state === 'release_pending') {
    await releaseExecutionFence(ref, value);
    snapshot = await ref.get();
    return publicCase(snapshot.id, snapshot.data() as AbsenceRetentionCase);
  }
  if (!['executing', 'execution_unknown'].includes(value.state)) throw invalid();
  if (execution.target.bucket !== store.bucketName) {
    await setExecutionProblem(ref, value, 'execution_review_required', 'storage_bucket_changed');
    throw new AppError({ code: 'ABSENCE_RETENTION_STORAGE_BUCKET_CHANGED', kind: 'CONFLICT',
      safeMessage: 'O destino do arquivo mudou e exige revisão humana.' });
  }
  const user = await dbAdmin.collection('users').doc(value.beneficiaryUid).get();
  const currentDate = user.exists ? terminationCivilDate(user.get('terminationDate')) : null;
  if (!user.exists || user.get('isActive') !== false || currentDate !== value.terminationDate
    || storedEmploymentCycleVersion(user.get('employmentCycleVersion')) !== storedEmploymentCycleVersion(value.employmentCycleVersion)
    || !executionMatchesFence(user.get('absenceDocumentDeletionFence'), value)) {
    await setExecutionProblem(ref, value, 'execution_review_required', 'execution_anchor_or_fence_changed');
    throw new AppError({ code: 'ABSENCE_RETENTION_EXECUTION_REVIEW_REQUIRED', kind: 'CONFLICT',
      safeMessage: 'A exclusão foi interrompida para revisão humana.' });
  }
  let storageState: 'exact' | 'missing' | 'different';
  try {
    storageState = await store.inspect(execution.target.storagePath,
      execution.target.generation, execution.target.sha256);
    if (storageState === 'exact') storageState = await store.removeExact(execution.target.storagePath,
      execution.target.generation) === 'removed' ? 'missing' : await store.inspect(
        execution.target.storagePath, execution.target.generation, execution.target.sha256);
  } catch (cause) {
    await setExecutionProblem(ref, value, 'execution_unknown', 'storage_result_unknown');
    throw new AppError({ code: 'ABSENCE_RETENTION_STORAGE_RESULT_UNKNOWN', kind: 'TRANSIENT_EXTERNAL',
      safeMessage: 'O resultado da exclusão será conferido automaticamente.', cause });
  }
  if (storageState === 'different') {
    await setExecutionProblem(ref, value, 'execution_review_required', 'storage_generation_changed');
    throw new AppError({ code: 'ABSENCE_RETENTION_STORAGE_GENERATION_CHANGED', kind: 'CONFLICT',
      safeMessage: 'O arquivo possui outra versão e exige revisão humana.' });
  }
  try {
    await finalizeRemovedBytes(ref, value);
  } catch (error) {
    const metadataChanged = error instanceof AppError && error.code === 'ABSENCE_RETENTION_ATTACHMENT_CHANGED';
    await setExecutionProblem(ref, value, metadataChanged ? 'execution_review_required' : 'execution_unknown',
      metadataChanged ? 'attachment_metadata_changed' : 'metadata_finalization_unknown');
    throw error;
  }
  snapshot = await ref.get(); value = snapshot.data() as AbsenceRetentionCase;
  await releaseExecutionFence(ref, value);
  snapshot = await ref.get();
  return publicCase(snapshot.id, snapshot.data() as AbsenceRetentionCase);
}
