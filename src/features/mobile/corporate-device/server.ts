import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { assertEmployeeUnitAccess } from '@/features/hr/lib/employee-document-access-server';
import type { CorporateDeviceDecisionInput, CorporateDeviceRequestInput } from './schemas';

const devices = dbAdmin.collection('mobileCorporateDevices');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function deviceId(workspaceId: string, installationId: string) {
  return hash(JSON.stringify(['coala-corporate-device', workspaceId, installationId]));
}

function audit(actor: ServerUserContext, action: string, ownerUid: string, id: string) {
  return { workspace_id: actor.workspace_id, user_id: actor.decoded.uid, module: 'mobile.corporate_device', action,
    timestamp: FieldValue.serverTimestamp(), ttl: new Date(Date.now() + 730 * 86_400_000),
    metadata: { ownerUid, deviceId: id } };
}

export async function requestCorporateDevice(actor: ServerUserContext, input: CorporateDeviceRequestInput) {
  const id = deviceId(actor.workspace_id, input.installationId);
  const ref = devices.doc(id);
  let status = 'pending';
  await dbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists && (current.get('workspaceId') !== actor.workspace_id || current.get('ownerUid') !== actor.decoded.uid)) {
      throw new AppError({ code: 'CORPORATE_DEVICE_ALREADY_OWNED', kind: 'CONFLICT', safeMessage: 'Esta instalação já pertence a outro cadastro.' });
    }
    status = current.exists ? String(current.get('status') ?? 'pending') : 'pending';
    if (status === 'replaced' || status === 'revoked' || status === 'rejected') status = 'pending';
    const now = FieldValue.serverTimestamp();
    tx.set(ref, { workspaceId: actor.workspace_id, ownerUid: actor.decoded.uid,
      installationHash: hash(input.installationId), deviceKeyId: input.deviceKeyId,
      devicePublicKey: input.devicePublicKey, keySecurity: input.keySecurity,
      appVersion: input.appVersion, model: input.model, androidVersion: input.androidVersion,
      status, requestedAt: current.get('requestedAt') ?? now, updatedAt: now, lastSeenAt: now,
      createdAt: current.get('createdAt') ?? now }, { merge: true });
    tx.set(dbAdmin.collection('actionLogs').doc(), audit(actor, current.exists ? 'device_request_refreshed' : 'device_requested', actor.decoded.uid, id));
  });
  return { deviceId: id, status };
}

export async function ownCorporateDevice(actor: ServerUserContext, installationId: string) {
  const snapshot = await devices.doc(deviceId(actor.workspace_id, installationId)).get();
  if (!snapshot.exists || snapshot.get('ownerUid') !== actor.decoded.uid || snapshot.get('workspaceId') !== actor.workspace_id) {
    return { device: null };
  }
  return { device: project(snapshot) };
}

function project(document: FirebaseFirestore.DocumentSnapshot) {
  const date = (field: string) => document.get(field)?.toDate?.()?.toISOString?.() ?? null;
  return { id: document.id, ownerUid: String(document.get('ownerUid') ?? ''), status: String(document.get('status') ?? 'pending'),
    model: String(document.get('model') ?? ''), androidVersion: String(document.get('androidVersion') ?? ''),
    appVersion: String(document.get('appVersion') ?? ''), keySecurity: String(document.get('keySecurity') ?? ''),
    requestedAt: date('requestedAt'), approvedAt: date('approvedAt'), updatedAt: date('updatedAt'), lastSeenAt: date('lastSeenAt') };
}

export async function listCorporateDevices(actor: ServerUserContext, ownerUid: string) {
  if (!actor.isDefaultAdmin && actor.permissions.settings.manageUsers !== true) {
    throw new AppError({ code: 'CORPORATE_DEVICE_MANAGE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar aparelhos empresariais.' });
  }
  await assertEmployeeUnitAccess(actor, ownerUid);
  const snapshot = await devices.where('workspaceId', '==', actor.workspace_id).where('ownerUid', '==', ownerUid).limit(20).get();
  return { devices: snapshot.docs.map(project).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) };
}

export async function decideCorporateDevice(actor: ServerUserContext, ownerUid: string, input: CorporateDeviceDecisionInput) {
  if (!actor.isDefaultAdmin && actor.permissions.settings.manageUsers !== true) {
    throw new AppError({ code: 'CORPORATE_DEVICE_MANAGE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar aparelhos empresariais.' });
  }
  await assertEmployeeUnitAccess(actor, ownerUid);
  const ref = devices.doc(input.deviceId);
  const targetStatus = { approve: 'active', reject: 'rejected', suspend: 'suspended', revoke: 'revoked' }[input.decision];
  await dbAdmin.runTransaction(async (tx) => {
    const [target, active] = await Promise.all([tx.get(ref), tx.get(devices.where('workspaceId', '==', actor.workspace_id)
      .where('ownerUid', '==', ownerUid).where('status', '==', 'active').limit(10))]);
    if (!target.exists || target.get('workspaceId') !== actor.workspace_id || target.get('ownerUid') !== ownerUid) {
      throw new AppError({ code: 'CORPORATE_DEVICE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Solicitação de aparelho não encontrada.' });
    }
    const now = FieldValue.serverTimestamp();
    if (targetStatus === 'active') active.docs.filter((item) => item.id !== ref.id).forEach((item) => tx.update(item.ref, {
      status: 'replaced', replacedByDeviceId: ref.id, replacedAt: now, updatedAt: now,
    }));
    const decisionField = input.decision === 'approve' ? 'approved' : targetStatus;
    tx.update(ref, { status: targetStatus, updatedAt: now,
      [`${decisionField}At`]: now, [`${decisionField}By`]: actor.decoded.uid });
    tx.set(dbAdmin.collection('actionLogs').doc(), audit(actor, `device_${targetStatus}`, ownerUid, ref.id));
  });
  return { deviceId: ref.id, status: targetStatus };
}
