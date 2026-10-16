import 'server-only';

import { createHash } from 'node:crypto';
import { FieldPath, Timestamp, type Query } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import type { DPResponsibilityActivity, DPResponsibilityTask } from '@/types';
import type { ResponsibilityTaskActionInput } from './schemas';
import { resolveOperationalResponsibility } from './service.server';

const tasks = dbAdmin.collection('dp_responsibilityTasks');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, safeMessage: string, kind: 'VALIDATION' | 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' | 'DATA_INTEGRITY' = 'CONFLICT') =>
  new AppError({ code, safeMessage, kind });

function canAdminister(actor: ServerUserContext) {
  return actor.isDefaultAdmin || actor.permissions.dp.responsibilities.manage === true;
}

function canReceiveGaps(actor: ServerUserContext) {
  return canAdminister(actor) || actor.permissions.dp.responsibilities.receiveUnassignedAlerts === true;
}

function canWorkSchedules(actor: ServerUserContext) {
  return actor.isDefaultAdmin || actor.permissions.dp.schedules.edit === true;
}

function checkedTask(document: FirebaseFirestore.DocumentSnapshot, workspaceId: string): DPResponsibilityTask {
  if (!document.exists || document.get('workspaceId') !== workspaceId) throw fail('DP_RESPONSIBILITY_TASK_NOT_FOUND', 'Pendência não encontrada.', 'NOT_FOUND');
  const task = { id: document.id, ...document.data() } as DPResponsibilityTask;
  if (!['unassigned', 'pending', 'claimed', 'resolved'].includes(task.status)
    || !Number.isSafeInteger(task.version) || task.version < 1 || !Array.isArray(task.assignedUserIds)
    || task.assignedUserIds.length > 20) throw fail('DP_RESPONSIBILITY_TASK_INVALID', 'A pendência está inconsistente.', 'DATA_INTEGRITY');
  return task;
}

export async function listResponsibilityTasks(actor: ServerUserContext, options: {
  status?: DPResponsibilityTask['status']; activity?: DPResponsibilityActivity; limit: number; cursor?: string;
}) {
  const administer = canAdminister(actor);
  const gapAccess = canReceiveGaps(actor);
  const scheduleAccess = canWorkSchedules(actor);
  if (!gapAccess && !scheduleAccess) throw fail('DP_RESPONSIBILITY_TASK_READ_FORBIDDEN', 'Sem permissão para consultar as pendências.', 'AUTHORIZATION');
  const gapOnly = !administer && gapAccess && (options.status === 'unassigned' || !scheduleAccess && !options.status);
  if (!administer && options.status === 'unassigned' && !gapAccess) {
    throw fail('DP_RESPONSIBILITY_TASK_READ_FORBIDDEN', 'Sem permissão para consultar pendências sem responsável.', 'AUTHORIZATION');
  }
  if (!administer && !scheduleAccess && !gapOnly) {
    throw fail('DP_RESPONSIBILITY_TASK_READ_FORBIDDEN', 'Sem permissão para consultar estas pendências.', 'AUTHORIZATION');
  }
  let query: Query = tasks.where('workspaceId', '==', actor.workspace_id);
  if (options.activity) query = query.where('activity', '==', options.activity);
  if (gapOnly) query = query.where('status', '==', 'unassigned');
  else if (options.status) query = query.where('status', '==', options.status);
  else query = query.where('status', 'in', administer ? ['unassigned', 'pending', 'claimed'] : ['pending', 'claimed']);
  if (!administer && !gapOnly) query = query.where('assignedUserIds', 'array-contains', actor.decoded.uid);
  query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (options.cursor) {
    const cursor = await tasks.doc(options.cursor).get();
    const value = checkedTask(cursor, actor.workspace_id);
    if ((options.activity && value.activity !== options.activity) || (options.status && value.status !== options.status)
      || gapOnly && value.status !== 'unassigned'
      || !options.status && !gapOnly && !['unassigned', 'pending', 'claimed'].includes(value.status)
      || !administer && !gapOnly && !value.assignedUserIds.includes(actor.decoded.uid)) {
      throw fail('DP_RESPONSIBILITY_TASK_CURSOR_INVALID', 'Cursor inválido.', 'VALIDATION');
    }
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(options.limit + 1).get();
  const documents = snapshot.docs.slice(0, options.limit);
  return { tasks: documents.map((document) => checkedTask(document, actor.workspace_id)),
    nextCursor: snapshot.size > options.limit ? documents.at(-1)?.id ?? null : null };
}

export async function actOnResponsibilityTask(actor: ServerUserContext, taskId: string, input: ResponsibilityTaskActionInput) {
  const reference = tasks.doc(taskId);
  return dbAdmin.runTransaction(async (tx) => {
    const document = await tx.get(reference);
    const task = checkedTask(document, actor.workspace_id);
    const operationHash = hash(JSON.stringify(input));
    if (document.get('lastOperationId') === input.operationId) {
      if (document.get('lastOperationActorUid') !== actor.decoded.uid || document.get('lastOperationHash') !== operationHash) {
        throw fail('DP_RESPONSIBILITY_TASK_IDEMPOTENCY_CONFLICT', 'A repetição da operação não corresponde à ação original.');
      }
      return task;
    }
    if (task.version !== input.expectedVersion) throw fail('DP_RESPONSIBILITY_TASK_VERSION_CONFLICT', 'A pendência foi alterada. Atualize e tente novamente.');
    const scoped = canAccessUnit(actor.userDoc, task.unitId, { isDefaultAdmin: actor.isDefaultAdmin });
    if (input.action === 'claim') {
      const currentCoverage = await resolveOperationalResponsibility({ transaction: tx,
        workspaceId: actor.workspace_id, activity: task.activity, unitId: task.unitId });
      const sameScope = currentCoverage.scope.kind === task.scope.kind && currentCoverage.scope.id === task.scope.id;
      if (task.status !== 'pending' || !task.assignedUserIds.includes(actor.decoded.uid)
        || !currentCoverage.resolution.eligibleUserIds.includes(actor.decoded.uid)
        || !sameScope || !canWorkSchedules(actor) || !scoped) {
        throw fail('DP_RESPONSIBILITY_TASK_CLAIM_FORBIDDEN', 'Esta pendência não está disponível para você.', 'AUTHORIZATION');
      }
    } else if (!(task.status === 'claimed' && task.claimedByUid === actor.decoded.uid && canWorkSchedules(actor) && scoped)
      && !actor.isDefaultAdmin) {
      throw fail('DP_RESPONSIBILITY_TASK_RESOLVE_FORBIDDEN', 'Somente quem assumiu a pendência pode concluí-la.', 'AUTHORIZATION');
    }
    if (input.action === 'resolve' && !['claimed', 'pending'].includes(task.status)) {
      throw fail('DP_RESPONSIBILITY_TASK_RESOLVE_UNAVAILABLE', 'A pendência não está disponível para conclusão.');
    }
    const now = new Date().toISOString();
    const version = task.version + 1;
    const update = input.action === 'claim'
      ? { status: 'claimed' as const, claimedByUid: actor.decoded.uid, claimedAt: now }
      : { status: 'resolved' as const, resolvedByUid: actor.decoded.uid, resolvedAt: now, resolutionNote: input.note };
    tx.update(reference, { ...update, version, updatedAt: now, lastOperationId: input.operationId,
      lastOperationActorUid: actor.decoded.uid, lastOperationHash: operationHash });
    tx.create(dbAdmin.collection('dp_responsibilityTaskAudit').doc(`${taskId}_${version}`), {
      workspaceId: actor.workspace_id, taskId, version, action: input.action, actorUid: actor.decoded.uid,
      ...(input.action === 'resolve' ? { note: input.note } : {}), at: now,
    });
    tx.create(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: actor.workspace_id, user_id: actor.decoded.uid, username: actor.userDoc.username ?? null,
      module: 'dp.responsibilities', action: input.action === 'claim' ? 'task_claimed' : 'task_resolved',
      metadata: { task_id: taskId, activity: task.activity, unit_id: task.unitId },
      ip_address: null, timestamp: Timestamp.now(), ttl: Timestamp.fromMillis(Date.now() + 365 * 86_400_000),
    });
    return { ...task, ...update, version, updatedAt: now } as DPResponsibilityTask;
  });
}
