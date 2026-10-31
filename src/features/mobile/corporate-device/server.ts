import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { assertEmployeeUnitAccess } from '@/features/hr/lib/employee-document-access-server';
import type { CorporateDeviceDecisionInput, CorporateDeviceRequestInput } from './schemas';

const devices = dbAdmin.collection('mobileCorporateDevices');
const AUTO_ENROLL_OWNER_UID = 'fvrLOh1JOIOtU5QhZQZydN3UBf22';
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
  if (actor.decoded.uid !== AUTO_ENROLL_OWNER_UID) {
    throw new AppError({ code: 'CORPORATE_DEVICE_REQUEST_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Vínculo empresarial indisponível para esta conta.' });
  }
  const id = deviceId(actor.workspace_id, input.installationId);
  const ref = devices.doc(id);
  let status = 'pending';
  await dbAdmin.runTransaction(async (tx) => {
    const [current, active] = await Promise.all([tx.get(ref), tx.get(devices.where('workspaceId', '==', actor.workspace_id)
      .where('ownerUid', '==', actor.decoded.uid).where('status', '==', 'active').limit(10))]);
    if (current.exists && (current.get('workspaceId') !== actor.workspace_id ||
      current.get('ownerUid') !== actor.decoded.uid && current.get('status') !== 'revoked')) {
      throw new AppError({ code: 'CORPORATE_DEVICE_ALREADY_OWNED', kind: 'CONFLICT', safeMessage: 'Esta instalação já pertence a outro cadastro.' });
    }
    status = current.exists ? String(current.get('status') ?? 'active') : 'active';
    if (current.exists && current.get('ownerUid') === actor.decoded.uid &&
      (status === 'revoked' || status === 'rejected' || status === 'suspended' || status === 'replaced')) {
      throw new AppError({ code: 'CORPORATE_DEVICE_REVIEW_REQUIRED', kind: 'AUTHORIZATION', safeMessage: 'Este aparelho requer revisão administrativa.' });
    }
    if (current.exists && current.get('ownerUid') === actor.decoded.uid && status === 'active' &&
      (current.get('deviceKeyId') !== input.deviceKeyId || current.get('devicePublicKey') !== input.devicePublicKey)) {
      throw new AppError({ code: 'CORPORATE_DEVICE_KEY_CHANGED', kind: 'CONFLICT', safeMessage: 'A chave deste aparelho mudou; procure a administração.' });
    }
    if (active.docs.some((item) => item.id !== ref.id)) {
      throw new AppError({ code: 'CORPORATE_DEVICE_ALREADY_ACTIVE', kind: 'CONFLICT', safeMessage: 'Outro aparelho já está vinculado; procure a administração.' });
    }
    status = 'active';
    const now = FieldValue.serverTimestamp();
    tx.set(ref, { workspaceId: actor.workspace_id, ownerUid: actor.decoded.uid,
      installationHash: hash(input.installationId), deviceKeyId: input.deviceKeyId,
      devicePublicKey: input.devicePublicKey, keySecurity: input.keySecurity,
      appVersion: input.appVersion, model: input.model, androidVersion: input.androidVersion,
      status, requestedAt: current.get('ownerUid') === actor.decoded.uid ? current.get('requestedAt') ?? now : now,
      approvedAt: current.get('ownerUid') === actor.decoded.uid ? current.get('approvedAt') ?? now : now,
      approvedBy: current.get('ownerUid') === actor.decoded.uid ? current.get('approvedBy') ?? 'system:corporate-device-heucilene' : 'system:corporate-device-heucilene',
      updatedAt: now, lastSeenAt: now,
      createdAt: current.get('ownerUid') === actor.decoded.uid ? current.get('createdAt') ?? now : now }, { merge: true });
    tx.set(dbAdmin.collection('actionLogs').doc(), audit(actor,
      current.exists && current.get('ownerUid') === actor.decoded.uid ? 'device_auto_refreshed' : 'device_auto_activated', actor.decoded.uid, id));
  });
  return { deviceId: id, status };
}

export async function ownCorporateDevice(actor: ServerUserContext, installationId: string) {
  if (actor.viewAs?.readOnly) return { device: null, autoEnrollAllowed: false, reviewRequired: false };
  const snapshot = await devices.doc(deviceId(actor.workspace_id, installationId)).get();
  if (!snapshot.exists) {
    return { device: null, autoEnrollAllowed: actor.decoded.uid === AUTO_ENROLL_OWNER_UID, reviewRequired: false };
  }
  if (snapshot.get('ownerUid') !== actor.decoded.uid || snapshot.get('workspaceId') !== actor.workspace_id) {
    const eligible = actor.decoded.uid === AUTO_ENROLL_OWNER_UID;
    const transferable = snapshot.get('workspaceId') === actor.workspace_id && snapshot.get('status') === 'revoked';
    return { device: null, autoEnrollAllowed: eligible && transferable, reviewRequired: eligible && !transferable };
  }
  return { device: project(snapshot), autoEnrollAllowed: false,
    reviewRequired: actor.decoded.uid === AUTO_ENROLL_OWNER_UID && snapshot.get('status') !== 'active' };
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
