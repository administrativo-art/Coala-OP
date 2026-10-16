import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { resolveAbsenceApprovers } from './approval.server';
import type { AbsenceRequestRecord } from './workflow-types';

const outbox = hrDbAdmin.collection('dp_absenceOutbox');
const requests = hrDbAdmin.collection('dp_absenceRequests');
const notifications = dbAdmin.collection('userNotifications');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function stableUuid(value: string) {
  const hex = hash(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function dispatchAbsenceNotification(requestId: string, version: number) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId) || !Number.isSafeInteger(version) || version < 1) {
    throw new AppError({ code: 'ABSENCE_NOTIFICATION_INPUT_INVALID', kind: 'VALIDATION' });
  }
  const leaseId = randomUUID();
  const now = new Date();
  const leased = await hrDbAdmin.runTransaction(async (tx) => {
    const requestDoc = await tx.get(requests.doc(requestId));
    if (!requestDoc.exists) return null;
    const request = requestDoc.data() as AbsenceRequestRecord;
    const eventRef = outbox.doc(`${requestId}_${version}_notification_${request.history.find((entry) => entry.version === version)?.action ?? ''}`);
    const fresh = await tx.get(eventRef);
    if (!fresh.exists) return null;
    const status = fresh.get('status');
    if (status === 'completed' || status === 'superseded') return null;
    if (status === 'leased' && String(fresh.get('leaseUntil')) > now.toISOString()) return null;
    if (status === 'retry' && String(fresh.get('nextAttemptAt')) > now.toISOString()) return null;
    if (!['pending', 'retry', 'leased'].includes(status)) return null;
    tx.update(eventRef, { status: 'leased', leaseId, leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      attempts: Number(fresh.get('attempts') ?? 0) + 1, updatedAt: now.toISOString() });
    return { request, eventRef, event: fresh };
  });
  if (!leased) return { state: 'not_due' as const };
  const { request, eventRef, event } = leased;
  const finish = async (status: 'completed' | 'retry' | 'superseded', result: Record<string, unknown> = {}) => {
    await hrDbAdmin.runTransaction(async (tx) => {
      const fresh = await tx.get(eventRef);
      if (!fresh.exists || fresh.get('leaseId') !== leaseId || fresh.get('status') !== 'leased') return;
      const attempts = Number(fresh.get('attempts') ?? 1);
      tx.update(eventRef, { status, leaseId: null, leaseUntil: null, updatedAt: new Date().toISOString(),
        nextAttemptAt: status === 'retry' ? new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(attempts, 6))).toISOString() : null,
        result });
    });
  };
  try {
    if (request.version !== version || event.get('workspaceId') !== request.workspaceId) {
      await finish('superseded', { reason: 'request_changed' });
      return { state: 'superseded' as const };
    }
    const recipients = event.get('recipients');
    if (!Array.isArray(recipients) || recipients.length > 20 || recipients.some((uid) => typeof uid !== 'string')) {
      await finish('superseded', { reason: 'recipient_invalid' });
      return { state: 'superseded' as const };
    }
    const pendingReview = request.status === 'in_review' && String(event.get('kind')).startsWith('notification_');
    let eligible = pendingReview ? request.assignedReviewerIds : [request.beneficiaryUid];
    if (pendingReview && request.stage) {
      const live = await resolveAbsenceApprovers(request.policySnapshot, request.stage, request.beneficiaryUid,
        request.unitId, request.requesterUid);
      eligible = eligible.filter((uid) => live.reviewerIds.includes(uid));
    }
    const targetUids = recipients.filter((uid) => eligible.includes(uid)).slice(0, 20);
    if (!targetUids.length) {
      await finish('superseded', { reason: 'no_eligible_recipients' });
      return { state: 'superseded' as const };
    }
    let projected = 0;
    for (const uid of targetUids) {
      const latest = await requests.doc(requestId).get();
      if (!latest.exists || latest.get('version') !== version || latest.get('workspaceId') !== request.workspaceId) {
        await finish('superseded', { reason: 'request_changed' });
        return { state: 'superseded' as const, projected };
      }
      const user = await dbAdmin.collection('users').doc(uid).get();
      if (!user.exists || user.get('isActive') !== true) continue;
      const notificationId = hash(`${event.id}:${uid}`);
      const notificationRef = notifications.doc(notificationId);
      const path = pendingReview ? '/dashboard/dp/requests' : '/dashboard/collaborator/requests';
      await dbAdmin.runTransaction(async (tx) => {
        const existing = await tx.get(notificationRef);
        if (!existing.exists) tx.create(notificationRef, { ownerUid: uid, workspaceId: request.workspaceId,
          eventId: stableUuid(`${event.get('eventId')}:${uid}`), sourceEventId: event.id,
          title: 'Coala', body: pendingReview ? 'Você tem uma solicitação para analisar. Prazo: 24 horas.' : 'Você tem uma atualização no Coala.',
          path, readAt: null, createdAt: event.get('createdAt') });
      });
      projected += 1;
    }
    await finish('completed', { projected, channel: 'in_app_bell' });
    return { state: 'completed' as const, projected };
  } catch {
    await finish('retry', { reason: 'delivery_failed' });
    return { state: 'retry' as const, projected: 0 };
  }
}
