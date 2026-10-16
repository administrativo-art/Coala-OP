import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { requireAbsenceWorkflowReady } from '../catalog.server';
import { absenceFileStore, type AbsenceFileStore } from './files.server';
import { resolveAbsenceApprovers } from './approval.server';
import type { AbsenceRequestRecord } from './workflow-types';

const deny = () => new AppError({ code: 'ABSENCE_ATTACHMENT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Comprovante indisponível.' });

export async function readAbsenceAttachment(actor: ServerUserContext, requestId: string, fileId: string, store: AbsenceFileStore = absenceFileStore) {
  await requireAbsenceWorkflowReady();
  const snapshot = await hrDbAdmin.collection('dp_absenceRequests').doc(requestId).get();
  if (!snapshot.exists) throw deny();
  const request = snapshot.data() as AbsenceRequestRecord;
  if (request.workspaceId !== actor.workspace_id) throw deny();
  const attachment = request.attachments.find((file) => file.id === fileId);
  if (!attachment || attachment.deletion) throw deny();
  const owner = request.beneficiaryUid === actor.decoded.uid;
  const custodian = request.custodianDpUid === actor.decoded.uid && actor.decoded.uid !== request.beneficiaryUid
    && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
    && canAccessUnit(actor.userDoc, request.unitId, { isDefaultAdmin: actor.isDefaultAdmin });
  let reviewer = false;
  if (!owner && !custodian && request.status === 'in_review' && request.stage
    && request.assignedReviewerIds.includes(actor.decoded.uid)
    && (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true)
    && canAccessUnit(actor.userDoc, request.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    const live = await resolveAbsenceApprovers(request.policySnapshot, request.stage, request.beneficiaryUid, request.unitId);
    reviewer = live.reviewerIds.includes(actor.decoded.uid);
  }
  if (!owner && !custodian && !reviewer) throw deny();
  if (!await store.verify(attachment.storagePath, attachment.generation, attachment.sha256)) throw deny();
  const bytes = await store.read(attachment.storagePath, attachment.generation);
  if (bytes.length !== attachment.size || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) throw deny();
  await hrDbAdmin.collection('dp_absenceAudit').doc(`file_${randomUUID()}`).create({ requestId, workspaceId: request.workspaceId,
    beneficiaryUid: request.beneficiaryUid, actorUid: actor.decoded.uid, action: 'attachment_read', fileId,
    at: new Date().toISOString(), ttl: new Date(Date.now() + 365 * 86_400_000) });
  return { bytes, mime: attachment.mime };
}

export async function removeAbsenceAttachment(actor: ServerUserContext, requestId: string, fileId: string, reason: string,
  store: AbsenceFileStore = absenceFileStore) {
  void actor; void requestId; void fileId; void reason; void store;
  throw new AppError({ code: 'ABSENCE_RETENTION_EXECUTION_NOT_READY', kind: 'CONFLICT',
    safeMessage: 'A exclusão física aguarda o controle de vínculo e autorização de retenção.' });
}
