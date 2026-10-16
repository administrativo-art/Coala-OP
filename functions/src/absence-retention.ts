import { createHash } from 'node:crypto';
import { type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PAGE = 20;
const DUE_PAGE = 50;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const stableUuid = (value: string) => {
  const hex = hash(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric',
  month: '2-digit', day: '2-digit' }).format(new Date());
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
export function retentionCivilDate(value: unknown): string | null {
  const date = typeof value === 'string' ? value : value && typeof value === 'object'
    && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate().toISOString().slice(0, 10) : null;
  const match = date?.match(datePattern);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1900 || year > 9979) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? date : null;
}
export function retentionReviewDate(date: string | null) {
  if (!date) return null;
  const year = Number(date.slice(0, 4)) + 20;
  const candidate = `${year}${date.slice(4)}`;
  if (candidate.endsWith('-02-29') && new Date(Date.UTC(year, 2, 0)).getUTCDate() !== 29) return `${year}-02-28`;
  return candidate;
}
function source(user: DocumentSnapshot) {
  const terminationDate = user.exists ? retentionCivilDate(user.get('terminationDate')) : null;
  const ended = user.exists && user.get('isActive') === false && terminationDate !== null;
  const sessionVersion = user.exists && Number.isSafeInteger(user.get('sessionVersion')) ? user.get('sessionVersion') as number : null;
  const sourceVersion = user.exists && typeof user.get('terminationDate')?.toMillis === 'function'
    ? user.get('terminationDate').toMillis() as number : null;
  const employmentCycleVersion = user.exists && Number.isSafeInteger(user.get('employmentCycleVersion'))
    && user.get('employmentCycleVersion') >= 0 ? user.get('employmentCycleVersion') as number : 0;
  return { terminationDate: ended ? terminationDate : null,
    reviewAfter: ended ? retentionReviewDate(terminationDate) : null,
    sessionVersion: ended ? sessionVersion : null, sourceVersion: ended ? sourceVersion : null,
    employmentCycleVersion: ended ? employmentCycleVersion : null,
    sourceDocumentVersion: user.updateTime?.toMillis() ?? null,
    sourceKey: hash(JSON.stringify([user.exists, user.get('isActive'), terminationDate, sessionVersion,
      employmentCycleVersion])) };
}

/** One bounded beneficiary page per invocation; RH task cursor supports retries across DB boundaries. */
export async function reconcileAbsenceRetentionPage(mainDb: Firestore, hrDb: Firestore,
  workspaceId: string, beneficiaryUid: string, user: DocumentSnapshot, pageSize = PAGE) {
  if (pageSize < 1 || pageSize > PAGE || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(beneficiaryUid)) throw Error('retention scope invalid');
  void mainDb;
  const anchor = source(user);
  const taskRef = hrDb.collection('dp_absenceRetentionReconciliations').doc(hash(`${workspaceId}:${beneficiaryUid}`));
  const task = await hrDb.runTransaction(async (tx) => {
    const current = await tx.get(taskRef);
    if (current.exists && current.get('sourceKey') === anchor.sourceKey) {
      return { cursor: current.get('cursor') as string | null, completed: current.get('state') === 'completed' };
    }
    tx.set(taskRef, { workspaceId, beneficiaryUid, sourceKey: anchor.sourceKey,
      state: 'pending', cursor: null, updatedAt: new Date().toISOString() });
    return { cursor: null, completed: false };
  });
  if (task.completed) return { state: 'completed' as const, processed: 0 };
  let query = hrDb.collection('dp_absenceRequests').where('workspaceId', '==', workspaceId)
    .where('beneficiaryUid', '==', beneficiaryUid).orderBy('__name__').limit(pageSize + 1);
  if (task.cursor) query = query.startAfter(task.cursor);
  const page = await query.get();
  const selected = page.docs.slice(0, pageSize);
  for (const request of selected) {
    const files = request.get('attachments');
    if (!Array.isArray(files) || files.length > 5) throw Error('retention attachments invalid');
    await hrDb.runTransaction(async (tx) => {
      const currentRequest = await tx.get(request.ref);
      if (!currentRequest.exists || currentRequest.get('workspaceId') !== workspaceId
        || currentRequest.get('beneficiaryUid') !== beneficiaryUid) throw Error('retention request changed');
      const currentFiles = currentRequest.get('attachments');
      if (!Array.isArray(currentFiles) || currentFiles.length > 5) throw Error('retention attachments changed');
      const caseRefs = currentFiles.map((file: { id?: unknown }) => {
        if (typeof file.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(file.id)) throw Error('retention file invalid');
        return hrDb.collection('dp_absenceRetentionCases').doc(`${request.id}_${file.id}`);
      });
      const existing = await Promise.all(caseRefs.map((ref) => tx.get(ref)));
      const now = new Date().toISOString();
      currentFiles.forEach((file: { id: string; deletion?: { state?: string } }, index: number) => {
        const before = existing[index];
        const custodianUid = currentRequest.get('custodianDpUid') ?? null;
        const valid = Boolean(anchor.reviewAfter && anchor.sessionVersion !== null && custodianUid
          && custodianUid !== beneficiaryUid && file.deletion?.state !== 'removed');
        const previousKey = before.exists ? hash(JSON.stringify([before.get('terminationDate'),
          before.get('terminationSessionVersion'), before.get('employmentCycleVersion') ?? 0])) : null;
        const nextKey = hash(JSON.stringify([anchor.terminationDate, anchor.sessionVersion,
          anchor.employmentCycleVersion ?? 0]));
        const anchorChanged = previousKey !== null && before.get('terminationDate') !== null && previousKey !== nextKey;
        const assignmentChanged = before.exists && (before.get('custodianUid') !== custodianUid
          || before.get('unitId') !== currentRequest.get('unitId'));
        const changed = anchorChanged || assignmentChanged;
        const previousState = before.exists ? before.get('state') : null;
        const effectiveReviewAfter = previousState === 'retained_until_review' && !changed
          ? before.get('reviewAfter') as string : anchor.reviewAfter;
        const executing = ['preparing_execution', 'executing', 'execution_unknown', 'release_pending',
          'execution_review_required'].includes(previousState);
        const state = file.deletion?.state === 'removed' ? 'removed'
          : executing && changed ? 'execution_review_required'
          : !custodianUid || changed ? 'needs_revalidation' : valid
            ? previousState === 'authorized' || previousState === 'retained_until_review'
              || previousState === 'awaiting_authorization' || previousState === 'execution_blocked' || executing
              ? previousState : 'scheduled'
            : previousState && previousState !== 'unanchored' ? 'needs_revalidation' : 'unanchored';
        const unchanged = before.exists && before.get('state') === state
          && before.get('terminationDate') === anchor.terminationDate
          && before.get('terminationSessionVersion') === anchor.sessionVersion
          && (before.get('employmentCycleVersion') ?? 0) === (anchor.employmentCycleVersion ?? 0)
          && before.get('custodianUid') === custodianUid
          && before.get('reviewAfter') === effectiveReviewAfter;
        if (unchanged) return;
        const payload = { workspaceId, requestId: request.id, fileId: file.id,
          beneficiaryUid, unitId: currentRequest.get('unitId'), custodianUid,
          state, version: before.exists ? Number(before.get('version')) + 1 : 1,
          terminationDate: anchor.terminationDate, terminationSourceVersion: anchor.sourceVersion,
          terminationSourceDocumentVersion: anchor.sourceDocumentVersion,
          terminationSessionVersion: anchor.sessionVersion, employmentCycleVersion: anchor.employmentCycleVersion,
          reviewAfter: effectiveReviewAfter,
          noticeStatus: state === 'scheduled' ? 'none' : before.get('noticeStatus') ?? 'none',
          createdAt: before.exists ? before.get('createdAt') : now, updatedAt: now };
        tx.set(caseRefs[index], payload, { merge: true });
        tx.create(hrDb.collection('dp_absenceRetentionAudit').doc(`${caseRefs[index].id}_${payload.version}`), {
          workspaceId, requestId: request.id, fileId: file.id, beneficiaryUid,
          action: 'termination_reconciled', state, at: now });
      });
    });
  }
  const nextCursor = page.size > pageSize ? selected[selected.length - 1].id : null;
  await hrDb.runTransaction(async (tx) => {
    const current = await tx.get(taskRef);
    if (!current.exists || current.get('sourceKey') !== anchor.sourceKey
      || current.get('cursor') !== task.cursor) throw Error('retention reconciliation raced');
    tx.update(taskRef, { cursor: nextCursor, state: nextCursor ? 'pending' : 'completed',
      updatedAt: new Date().toISOString() });
  });
  return { state: nextCursor ? 'pending' as const : 'completed' as const, processed: selected.length };
}

/** Scheduled bounded continuation: no full collection scan and no deletion. */
export async function continueAbsenceRetentionReconciliations(mainDb: Firestore, hrDb: Firestore, limit = 20) {
  const tasks = await hrDb.collection('dp_absenceRetentionReconciliations').where('state', '==', 'pending')
    .orderBy('updatedAt').limit(Math.max(1, Math.min(limit, 20))).get();
  for (const task of tasks.docs) {
    const uid = task.get('beneficiaryUid');
    const workspaceId = task.get('workspaceId');
    if (typeof uid !== 'string' || typeof workspaceId !== 'string') throw Error('retention task invalid');
    const user = await mainDb.collection('users').doc(uid).get();
    await reconcileAbsenceRetentionPage(mainDb, hrDb, workspaceId, uid, user);
  }
  return tasks.size;
}

function custodianEligible(user: DocumentSnapshot, profile: DocumentSnapshot, caseData: FirebaseFirestore.DocumentData) {
  if (!user.exists || user.get('isActive') !== true || !profile.exists) return false;
  if (user.id === caseData.beneficiaryUid) return false;
  const defaultAdmin = profile.get('isDefaultAdmin') === true;
  if (!defaultAdmin && profile.get('permissions.dp.requests.review') !== true) return false;
  const allUnits = defaultAdmin || user.get('unitAccessScope') === 'all';
  const units = user.get('unitAccessScope') === 'selected' ? user.get('unitAccessUnitIds')
    : [...(Array.isArray(user.get('unitIds')) ? user.get('unitIds') : []),
      ...(Array.isArray(user.get('assignedKioskIds')) ? user.get('assignedKioskIds') : [])];
  return allUnits || Array.isArray(units) && units.includes(caseData.unitId);
}

/** One daily bounded pass per state, plus bounded retry of projected notifications. */
export async function detectDueAbsenceRetention(mainDb: Firestore, hrDb: Firestore, asOf = today()) {
  if (!retentionCivilDate(asOf)) throw Error('retention date invalid');
  const cases = hrDb.collection('dp_absenceRetentionCases');
  for (const state of ['scheduled', 'retained_until_review']) {
    const due = await cases.where('state', '==', state).where('reviewAfter', '<=', asOf)
      .orderBy('reviewAfter').limit(DUE_PAGE + 1).get();
    for (const item of due.docs.slice(0, DUE_PAGE)) {
      await hrDb.runTransaction(async (tx) => {
        const current = await tx.get(item.ref);
        if (!current.exists || current.get('state') !== state || current.get('reviewAfter') > asOf) return;
        tx.update(item.ref, { state: 'awaiting_authorization', version: Number(current.get('version')) + 1,
          noticeStatus: 'pending', updatedAt: new Date().toISOString() });
        tx.create(hrDb.collection('dp_absenceRetentionAudit').doc(`${item.id}_${Number(current.get('version')) + 1}`), {
          workspaceId: current.get('workspaceId'), requestId: current.get('requestId'), fileId: current.get('fileId'),
          beneficiaryUid: current.get('beneficiaryUid'), action: 'review_due', at: new Date().toISOString() });
      });
    }
  }
  const pending = await cases.where('state', '==', 'awaiting_authorization')
    .where('noticeStatus', '==', 'pending').limit(DUE_PAGE + 1).get();
  let projected = 0;
  for (const item of pending.docs.slice(0, DUE_PAGE)) {
    const uid = item.get('custodianUid');
    const user = typeof uid === 'string' ? await mainDb.collection('users').doc(uid).get() : null;
    const profile = user?.exists && typeof user.get('profileId') === 'string'
      ? await mainDb.collection('profiles').doc(user.get('profileId')).get() : null;
    const request = await hrDb.collection('dp_absenceRequests').doc(item.get('requestId')).get();
    const beneficiary = await mainDb.collection('users').doc(item.get('beneficiaryUid')).get();
    const anchor = source(beneficiary);
    const valid = user && profile && custodianEligible(user, profile, item.data())
      && request.exists && request.get('workspaceId') === item.get('workspaceId')
      && request.get('custodianDpUid') === uid && request.get('unitId') === item.get('unitId')
      && anchor.terminationDate === item.get('terminationDate')
      && anchor.sessionVersion === item.get('terminationSessionVersion')
      && (anchor.employmentCycleVersion ?? 0) === (item.get('employmentCycleVersion') ?? 0);
    if (!valid) {
      await hrDb.runTransaction(async (tx) => {
        const current = await tx.get(item.ref);
        if (current.exists && current.get('state') === 'awaiting_authorization'
          && current.get('noticeStatus') === 'pending') {
          const now = new Date().toISOString();
          tx.update(item.ref, { state: 'needs_revalidation', version: Number(current.get('version')) + 1,
            updatedAt: now });
          tx.create(hrDb.collection('dp_absenceRetentionAudit').doc(`${item.id}_${Number(current.get('version')) + 1}`), {
            workspaceId: current.get('workspaceId'), requestId: current.get('requestId'),
            fileId: current.get('fileId'), beneficiaryUid: current.get('beneficiaryUid'),
            action: 'custodian_or_anchor_revalidation_required', at: now });
        }
      });
      continue;
    }
    const notification = mainDb.collection('userNotifications').doc(hash(`absence-retention:${item.id}:${item.get('version')}:${uid}`));
    await mainDb.runTransaction(async (tx) => {
      const old = await tx.get(notification);
      if (!old.exists) tx.create(notification, { ownerUid: uid, workspaceId: item.get('workspaceId'),
        eventId: stableUuid(`absence-retention:${item.id}:${item.get('version')}:${uid}`),
        sourceEventId: item.id, title: 'Coala', body: 'Você tem uma revisão pendente no Coala.',
        path: '/dashboard/dp/requests', readAt: null, createdAt: item.get('updatedAt') });
    });
    await hrDb.runTransaction(async (tx) => {
      const current = await tx.get(item.ref);
      if (current.exists && current.get('state') === 'awaiting_authorization'
        && current.get('noticeStatus') === 'pending' && current.get('version') === item.get('version')) {
        tx.update(item.ref, { noticeStatus: 'sent', noticeSentAt: new Date().toISOString() });
      }
    });
    projected += 1;
  }
  return { projected, dueLimit: DUE_PAGE };
}

type ExecutionTarget = { bucket: string; storagePath: string; generation: string; sha256: string };
type ExecutionData = { operationId: string; actorUid: string; startedAt: string; updatedAt: string;
  target: ExecutionTarget };
export type AbsenceRetentionExecutionStore = {
  bucketName: string;
  inspect(target: ExecutionTarget): Promise<'exact' | 'missing' | 'different'>;
  removeExact(target: ExecutionTarget): Promise<'removed' | 'missing' | 'different'>;
};

export function absenceRetentionExecutionStore(bucketName: string): AbsenceRetentionExecutionStore {
  const bucket = getStorage().bucket(bucketName);
  return {
    bucketName,
    async inspect(target) {
      try {
        const [metadata] = await bucket.file(target.storagePath).getMetadata();
        return String(metadata.generation) === target.generation && metadata.metadata?.sha256 === target.sha256
          ? 'exact' : 'different';
      } catch (error) {
        if (Number((error as { code?: unknown }).code) === 404) return 'missing';
        throw error;
      }
    },
    async removeExact(target) {
      try {
        await bucket.file(target.storagePath).delete({ ifGenerationMatch: target.generation });
        return 'removed';
      } catch (error) {
        const code = Number((error as { code?: unknown }).code);
        if (code === 404) return 'missing';
        if (code === 409 || code === 412) return 'different';
        throw error;
      }
    },
  };
}

function execution(document: DocumentSnapshot) {
  const value = document.get('execution') as ExecutionData | undefined;
  if (!value?.operationId || !value.actorUid || !value.target?.storagePath || !value.target.generation
    || !value.target.sha256 || !value.target.bucket) throw Error('retention execution invalid');
  return value;
}
function fenceMatches(fence: unknown, caseId: string, operationId: string) {
  if (!fence || typeof fence !== 'object') return false;
  const value = fence as Record<string, unknown>;
  return value.caseId === caseId && value.operationId === operationId;
}
async function markExecutionProblem(mainDb: Firestore, hrDb: Firestore, item: DocumentSnapshot,
  state: 'execution_unknown' | 'execution_review_required', action: string) {
  const run = execution(item);
  const now = new Date().toISOString();
  await hrDb.runTransaction(async (tx) => {
    const current = await tx.get(item.ref);
    if (!current.exists || current.get('execution.operationId') !== run.operationId || current.get('state') === 'removed') return;
    const version = Number(current.get('version')) + 1;
    tx.update(item.ref, { state, version, 'execution.updatedAt': now, updatedAt: now });
    tx.set(hrDb.collection('dp_absenceRetentionAudit').doc(`${item.id}_${version}`), {
      workspaceId: current.get('workspaceId'), requestId: current.get('requestId'), fileId: current.get('fileId'),
      beneficiaryUid: current.get('beneficiaryUid'), actorUid: run.actorUid, operationId: run.operationId,
      action, at: now,
    });
  });
  await mainDb.runTransaction(async (tx) => {
    const userRef = mainDb.collection('users').doc(item.get('beneficiaryUid'));
    const user = await tx.get(userRef);
    if (user.exists && fenceMatches(user.get('absenceDocumentDeletionFence'), item.id, run.operationId)) {
      tx.update(userRef, { 'absenceDocumentDeletionFence.state': state === 'execution_unknown'
        ? 'execution_unknown' : 'review_required', 'absenceDocumentDeletionFence.updatedAt': now });
    }
  });
}

async function acquireExecutionFence(mainDb: Firestore, hrDb: Firestore, item: DocumentSnapshot) {
  const run = execution(item);
  const now = new Date().toISOString();
  let anchored = false;
  await mainDb.runTransaction(async (tx) => {
    const userRef = mainDb.collection('users').doc(item.get('beneficiaryUid'));
    const user = await tx.get(userRef);
    const date = user.exists ? retentionCivilDate(user.get('terminationDate')) : null;
    const cycle = user.exists && Number.isSafeInteger(user.get('employmentCycleVersion'))
      && user.get('employmentCycleVersion') >= 0 ? user.get('employmentCycleVersion') as number : 0;
    const existing = user.get('absenceDocumentDeletionFence');
    anchored = user.exists && user.get('isActive') === false && date === item.get('terminationDate')
      && cycle === (item.get('employmentCycleVersion') ?? 0)
      && user.get('sessionVersion') === item.get('terminationSessionVersion');
    if (!anchored || existing && !fenceMatches(existing, item.id, run.operationId)) return;
    tx.set(userRef, { absenceDocumentDeletionFence: { protocolVersion: 1, workspaceId: item.get('workspaceId'),
      caseId: item.id, operationId: run.operationId, state: 'executing', employmentCycleVersion: cycle,
      terminationDate: date, startedAt: run.startedAt, updatedAt: now } }, { merge: true });
  });
  if (!anchored) {
    await markExecutionProblem(mainDb, hrDb, item, 'execution_review_required', 'execution_anchor_changed');
    return false;
  }
  const user = await mainDb.collection('users').doc(item.get('beneficiaryUid')).get();
  if (!fenceMatches(user.get('absenceDocumentDeletionFence'), item.id, run.operationId)) {
    await markExecutionProblem(mainDb, hrDb, item, 'execution_review_required', 'execution_fence_busy');
    return false;
  }
  await hrDb.runTransaction(async (tx) => {
    const current = await tx.get(item.ref);
    if (current.exists && current.get('state') === 'preparing_execution'
      && current.get('execution.operationId') === run.operationId) {
      tx.update(item.ref, { state: 'executing', version: Number(current.get('version')) + 1,
        'execution.updatedAt': now, updatedAt: now });
    }
  });
  return true;
}

async function finalizeExecution(mainDb: Firestore, hrDb: Firestore, item: DocumentSnapshot) {
  const run = execution(item);
  const now = new Date().toISOString();
  const requestRef = hrDb.collection('dp_absenceRequests').doc(item.get('requestId'));
  const receiptRef = hrDb.collection('dp_absenceRetentionExecutionReceipts')
    .doc(hash(`${item.id}:${run.operationId}`));
  await hrDb.runTransaction(async (tx) => {
    const [current, request] = await Promise.all([tx.get(item.ref), tx.get(requestRef)]);
    if (!current.exists || !request.exists || current.get('execution.operationId') !== run.operationId) {
      throw Error('retention execution changed');
    }
    if (current.get('state') === 'release_pending' || current.get('state') === 'removed') return;
    const attachments = request.get('attachments');
    const index = Array.isArray(attachments) ? attachments.findIndex((file: { id?: unknown }) => file.id === item.get('fileId')) : -1;
    const attachment = index >= 0 ? attachments[index] as Record<string, unknown> : null;
    if (!attachment || attachment.storagePath !== run.target.storagePath
      || attachment.generation !== run.target.generation || attachment.sha256 !== run.target.sha256) {
      throw Error('retention attachment changed');
    }
    const next = [...attachments];
    next[index] = { ...attachment, deletion: { state: 'removed', requestedAt: run.startedAt, completedAt: now,
      actorUid: run.actorUid, reason: current.get('decision.reason') ?? 'Exclusão autorizada após retenção.' } };
    const version = Number(current.get('version')) + 1;
    tx.update(requestRef, { attachments: next, updatedAt: now });
    tx.update(item.ref, { state: 'release_pending', version, 'execution.updatedAt': now, updatedAt: now });
    tx.set(receiptRef, { state: 'release_pending', removedAt: now, updatedAt: now }, { merge: true });
    tx.set(hrDb.collection('dp_absenceRetentionAudit').doc(`${item.id}_${version}`), {
      workspaceId: current.get('workspaceId'), requestId: current.get('requestId'), fileId: current.get('fileId'),
      beneficiaryUid: current.get('beneficiaryUid'), actorUid: run.actorUid, operationId: run.operationId,
      action: 'storage_generation_removed', at: now,
    });
  });
}

async function releaseExecution(mainDb: Firestore, hrDb: Firestore, item: DocumentSnapshot) {
  const run = execution(item);
  const userRef = mainDb.collection('users').doc(item.get('beneficiaryUid'));
  let fenceConflict = false;
  await mainDb.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) { fenceConflict = true; return; }
    const fence = user.get('absenceDocumentDeletionFence');
    if (!fence) return;
    if (!fenceMatches(fence, item.id, run.operationId)) { fenceConflict = true; return; }
    // Use an explicit null sentinel here so emulator/integration callers that load
    // this module through another firebase-admin installation do not mix transform
    // prototypes. All guards treat only an object as an active fence.
    tx.update(userRef, { absenceDocumentDeletionFence: null });
  });
  if (fenceConflict) {
    await markExecutionProblem(mainDb, hrDb, item, 'execution_review_required', 'execution_release_fence_changed');
    return false;
  }
  const now = new Date().toISOString();
  await hrDb.runTransaction(async (tx) => {
    const current = await tx.get(item.ref);
    if (!current.exists || current.get('execution.operationId') !== run.operationId) throw Error('retention execution changed');
    if (current.get('state') === 'removed') return;
    if (current.get('state') !== 'release_pending') throw Error('retention release invalid');
    const version = Number(current.get('version')) + 1;
    tx.update(item.ref, { state: 'removed', version, 'execution.updatedAt': now, updatedAt: now });
    tx.set(hrDb.collection('dp_absenceRetentionExecutionReceipts').doc(hash(`${item.id}:${run.operationId}`)),
      { state: 'removed', completedAt: now, updatedAt: now }, { merge: true });
    tx.set(hrDb.collection('dp_absenceRetentionAudit').doc(`${item.id}_${version}`), {
      workspaceId: current.get('workspaceId'), requestId: current.get('requestId'), fileId: current.get('fileId'),
      beneficiaryUid: current.get('beneficiaryUid'), actorUid: run.actorUid, operationId: run.operationId,
      action: 'execution_completed', at: now,
    });
  });
  return true;
}

export async function reconcileAbsenceRetentionExecution(mainDb: Firestore, hrDb: Firestore,
  item: DocumentSnapshot, store: AbsenceRetentionExecutionStore) {
  let current = item;
  if (current.get('state') === 'preparing_execution') {
    if (!await acquireExecutionFence(mainDb, hrDb, current)) return 'review_required' as const;
    current = await current.ref.get();
  }
  if (current.get('state') === 'release_pending') {
    return await releaseExecution(mainDb, hrDb, current) ? 'removed' as const : 'review_required' as const;
  }
  if (!['executing', 'execution_unknown'].includes(current.get('state'))) return 'ignored' as const;
  const run = execution(current);
  if (run.target.bucket !== store.bucketName) {
    await markExecutionProblem(mainDb, hrDb, current, 'execution_review_required', 'storage_bucket_changed');
    return 'review_required' as const;
  }
  const user = await mainDb.collection('users').doc(current.get('beneficiaryUid')).get();
  const cycle = user.exists && Number.isSafeInteger(user.get('employmentCycleVersion'))
    && user.get('employmentCycleVersion') >= 0 ? user.get('employmentCycleVersion') as number : 0;
  if (!user.exists || user.get('isActive') !== false
    || retentionCivilDate(user.get('terminationDate')) !== current.get('terminationDate')
    || cycle !== (current.get('employmentCycleVersion') ?? 0)
    || !fenceMatches(user.get('absenceDocumentDeletionFence'), current.id, run.operationId)) {
    await markExecutionProblem(mainDb, hrDb, current, 'execution_review_required', 'execution_anchor_or_fence_changed');
    return 'review_required' as const;
  }
  let state: 'exact' | 'missing' | 'different';
  try {
    state = await store.inspect(run.target);
    if (state === 'exact') {
      const removed = await store.removeExact(run.target);
      state = removed === 'removed' ? 'missing' : removed;
    }
  } catch {
    await markExecutionProblem(mainDb, hrDb, current, 'execution_unknown', 'storage_result_unknown');
    return 'unknown' as const;
  }
  if (state === 'different') {
    await markExecutionProblem(mainDb, hrDb, current, 'execution_review_required', 'storage_generation_changed');
    return 'review_required' as const;
  }
  try {
    await finalizeExecution(mainDb, hrDb, current);
  } catch {
    await markExecutionProblem(mainDb, hrDb, current, 'execution_unknown', 'metadata_finalization_unknown');
    return 'unknown' as const;
  }
  current = await current.ref.get();
  return await releaseExecution(mainDb, hrDb, current) ? 'removed' as const : 'review_required' as const;
}

/** One bounded queue query; completed/review cases do not participate in recurring reads. */
export async function continueAbsenceRetentionExecutions(mainDb: Firestore, hrDb: Firestore,
  store: AbsenceRetentionExecutionStore, limit = 20) {
  const pending = await hrDb.collection('dp_absenceRetentionCases')
    .where('state', 'in', ['preparing_execution', 'executing', 'execution_unknown', 'release_pending'])
    .limit(Math.max(1, Math.min(limit, 20))).get();
  const results = { processed: pending.size, removed: 0, unknown: 0, reviewRequired: 0 };
  for (const item of pending.docs) {
    const state = await reconcileAbsenceRetentionExecution(mainDb, hrDb, item, store);
    if (state === 'removed') results.removed += 1;
    else if (state === 'unknown') results.unknown += 1;
    else if (state === 'review_required') results.reviewRequired += 1;
  }
  return results;
}
