import 'server-only';

import { getMessaging } from 'firebase-admin/messaging';
import { FieldValue } from 'firebase-admin/firestore';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { pushDeliverySchema, safePushPath } from './schemas';

type ProviderResult = { responses: Array<{ success: boolean; error?: { code?: string } }> };
export type PushProvider = { send(tokens: string[], data: Record<string, string>): Promise<ProviderResult> };

const firebaseProvider: PushProvider = {
  async send(tokens, data) {
    if (process.env.FIRESTORE_EMULATOR_HOST || [process.env.FIREBASE_PROJECT_ID, process.env.GOOGLE_CLOUD_PROJECT]
      .some((value) => value?.startsWith('demo-'))) {
      throw new AppError({ code: 'PUSH_FCM_DISABLED_LOCALLY', kind: 'CONFLICT' });
    }
    return getMessaging(adminApp).sendEachForMulticast({ tokens, data, android: { priority: 'normal' } });
  },
};
const invalidCodes = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

/** Internal only. Callers own eventId stability; FCM does not provide exactly-once delivery. */
export async function sendUserPush(raw: unknown, provider: PushProvider = firebaseProvider) {
  const parsed = pushDeliverySchema.safeParse(raw);
  if (!parsed.success || !safePushPath(parsed.data.path)) throw new AppError({ code: 'PUSH_DELIVERY_INVALID', kind: 'VALIDATION', safeMessage: 'Destino de notificação inválido.' });
  const input = parsed.data;
  const user = await dbAdmin.collection('users').doc(input.recipientUid).get();
  if (!user.exists || user.get('isActive') !== true) return { attempted: 0, acceptedByProvider: 0, failed: 0, inactive: true };
  const snapshot = await dbAdmin.collection('mobilePushTokens')
    .where('workspaceId', '==', input.workspaceId).where('ownerUid', '==', input.recipientUid).where('active', '==', true).limit(11).get();
  if (snapshot.size > 10) throw new AppError({ code: 'PUSH_DEVICE_LIMIT_INTEGRITY', kind: 'DATA_INTEGRITY', safeMessage: 'Não foi possível entregar a notificação agora.' });
  const devices = snapshot.docs.filter((doc) => typeof doc.get('token') === 'string');
  if (!devices.length) return { attempted: 0, acceptedByProvider: 0, failed: 0, inactive: false };
  if (provider === firebaseProvider && (process.env.FIRESTORE_EMULATOR_HOST
    || [process.env.FIREBASE_PROJECT_ID, process.env.GOOGLE_CLOUD_PROJECT].some((value) => value?.startsWith('demo-')))) {
    return { attempted: 0, acceptedByProvider: 0, failed: 0, inactive: false, deferred: true };
  }
  const data = { recipientId: input.recipientUid, eventId: input.eventId, path: `https://op.coalashakes.com${input.path}`,
    title: 'Coala Go', body: 'Você tem uma atualização no Coala.' };
  let responses: ProviderResult['responses'];
  try {
    responses = (await provider.send(devices.map((doc) => doc.get('token') as string), data)).responses;
    if (responses.length !== devices.length) throw new Error('FCM response length mismatch');
  } catch {
    await dbAdmin.collection('actionLogs').add({ workspace_id: input.workspaceId, user_id: input.recipientUid,
      module: 'mobile.push', action: 'delivery_failed', metadata: { eventId: input.eventId, attempted: devices.length }, timestamp: FieldValue.serverTimestamp(), ttl: new Date(Date.now() + 365 * 86_400_000) });
    return { attempted: devices.length, acceptedByProvider: 0, failed: devices.length, inactive: false };
  }
  let acceptedByProvider = 0;
  for (let index = 0; index < devices.length; index += 1) {
    const response = responses[index];
    if (response.success) { acceptedByProvider += 1; continue; }
    if (!invalidCodes.has(response.error?.code ?? '')) continue;
    const document = devices[index];
    await dbAdmin.runTransaction(async (tx) => {
      const fresh = await tx.get(document.ref);
      if (fresh.exists && fresh.get('active') === true && fresh.get('ownerUid') === input.recipientUid && fresh.get('token') === document.get('token')) {
        const installHash = fresh.get('installationHash');
        if (typeof installHash === 'string') {
          const installRef = dbAdmin.collection('mobilePushInstallations').doc(installHash);
          const install = await tx.get(installRef);
          if (install.exists && install.get('tokenHash') === document.id) tx.update(installRef, { active: false, tokenHash: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
        }
        tx.update(document.ref, { active: false, token: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      }
    });
  }
  await dbAdmin.collection('actionLogs').add({ workspace_id: input.workspaceId, user_id: input.recipientUid,
    module: 'mobile.push', action: 'delivery_attempted', metadata: { eventId: input.eventId, attempted: devices.length, acceptedByProvider, failed: devices.length - acceptedByProvider }, timestamp: FieldValue.serverTimestamp(), ttl: new Date(Date.now() + 365 * 86_400_000) });
  return { attempted: devices.length, acceptedByProvider, failed: devices.length - acceptedByProvider, inactive: false };
}
