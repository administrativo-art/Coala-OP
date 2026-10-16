import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { RegisterPushDeviceInput } from './schemas';

const tokens = dbAdmin.collection('mobilePushTokens');
const installations = dbAdmin.collection('mobilePushInstallations');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const MAX_DEVICES = 10;

function audit(actor: ServerUserContext, action: string, installationHash: string) {
  return { workspace_id: actor.workspace_id, user_id: actor.decoded.uid, module: 'mobile.push', action,
    timestamp: FieldValue.serverTimestamp(), ttl: new Date(Date.now() + 365 * 86_400_000),
    metadata: { source: 'coala-go', installationHash } };
}

export async function registerPushDevice(actor: ServerUserContext, input: RegisterPushDeviceInput) {
  const ownerUid = actor.decoded.uid;
  const tokenHash = hash(input.token);
  const installHash = hash(input.installationId);
  const tokenRef = tokens.doc(tokenHash);
  const installRef = installations.doc(installHash);
  await dbAdmin.runTransaction(async (tx) => {
    const [existingToken, existingInstall, active] = await Promise.all([
      tx.get(tokenRef), tx.get(installRef),
      tx.get(tokens.where('workspaceId', '==', actor.workspace_id).where('ownerUid', '==', ownerUid).where('active', '==', true).limit(MAX_DEVICES + 1)),
    ]);
    const replacingOwned = existingInstall.exists && existingInstall.get('ownerUid') === ownerUid && existingInstall.get('active') === true;
    const alreadyOwned = existingToken.exists && existingToken.get('ownerUid') === ownerUid && existingToken.get('active') === true;
    if (alreadyOwned && replacingOwned && existingToken.get('installationHash') === installHash && existingInstall.get('tokenHash') === tokenHash
      && existingToken.get('packageName') === input.packageName && existingToken.get('appVersion') === (input.appVersion ?? null)
      && existingToken.get('updatedAt')?.toMillis?.() > Date.now() - 86_400_000) return;
    if (active.size > MAX_DEVICES || (active.size === MAX_DEVICES && !replacingOwned && !alreadyOwned)) {
      throw new AppError({ code: 'PUSH_DEVICE_LIMIT', kind: 'VALIDATION', safeMessage: 'Limite de aparelhos para notificações atingido.' });
    }
    const previousHash = existingInstall.get('tokenHash');
    const previousInstallationHash = existingToken.get('installationHash');
    const previousTokenRef = typeof previousHash === 'string' && previousHash !== tokenHash ? tokens.doc(previousHash) : null;
    const previousInstallRef = typeof previousInstallationHash === 'string' && previousInstallationHash !== installHash ? installations.doc(previousInstallationHash) : null;
    const [previousToken, previousInstall] = await Promise.all([
      previousTokenRef ? tx.get(previousTokenRef) : null,
      previousInstallRef ? tx.get(previousInstallRef) : null,
    ]);
    if (previousTokenRef && previousToken?.exists && previousToken.get('installationHash') === installHash) tx.update(previousTokenRef, { active: false, token: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    if (previousInstallRef && previousInstall?.exists && previousInstall.get('tokenHash') === tokenHash) tx.update(previousInstallRef, { active: false, tokenHash: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    const now = FieldValue.serverTimestamp();
    tx.set(tokenRef, { workspaceId: actor.workspace_id, ownerUid, installationHash: installHash, token: input.token,
      packageName: input.packageName, appVersion: input.appVersion ?? null, active: true, updatedAt: now,
      createdAt: existingToken.exists ? existingToken.get('createdAt') ?? now : now });
    tx.set(installRef, { workspaceId: actor.workspace_id, ownerUid, tokenHash, active: true, updatedAt: now,
      createdAt: existingInstall.exists ? existingInstall.get('createdAt') ?? now : now });
    tx.set(dbAdmin.collection('actionLogs').doc(), audit(actor, 'device_registered', installHash));
  });
  return { registered: true } as const;
}

export async function removePushDevice(actor: ServerUserContext, installationId: string) {
  const installHash = hash(installationId);
  const installRef = installations.doc(installHash);
  await dbAdmin.runTransaction(async (tx) => {
    const installation = await tx.get(installRef);
    if (!installation.exists || installation.get('ownerUid') !== actor.decoded.uid || installation.get('workspaceId') !== actor.workspace_id) {
      throw new AppError({ code: 'PUSH_DEVICE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Instalação não encontrada.' });
    }
    if (!installation.get('active')) return;
    const tokenHash = installation.get('tokenHash');
    const tokenRef = typeof tokenHash === 'string' ? tokens.doc(tokenHash) : null;
    const token = tokenRef ? await tx.get(tokenRef) : null;
    if (tokenRef && token?.exists && token.get('installationHash') === installHash && token.get('ownerUid') === actor.decoded.uid) {
      tx.update(tokenRef, { active: false, token: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    tx.update(installRef, { active: false, tokenHash: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(dbAdmin.collection('actionLogs').doc(), audit(actor, 'device_removed', installHash));
  });
  return { removed: true } as const;
}
