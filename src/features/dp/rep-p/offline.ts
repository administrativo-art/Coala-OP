import { createHash, createPublicKey, verify } from 'node:crypto';

import { formatRepPAfdTimestamp } from './clock';

export const REP_P_OFFLINE_PERMIT_TTL_MS = 12 * 60 * 60 * 1000;
export const REP_P_OFFLINE_MAX_PENDING = 20;

export type RepPOfflineEvidence = Readonly<{
  permitId: string;
  deviceKeyId: string;
  elapsedRealtimeMs: number;
  bootCount: number;
  sequence: number;
  previousLocalHash: string | null;
  markedAt: string;
  localHash: string;
  signature: string;
}>;

export function canonicalRepPOfflineEvent(input: {
  permitId: string;
  attemptId: string;
  executionUnitId: string;
  deviceKeyId: string;
  elapsedRealtimeMs: number;
  bootCount: number;
  sequence: number;
  previousLocalHash: string | null;
  markedAt: string;
}) {
  return [
    'coala-rep-p-offline-v1', input.permitId, input.attemptId, input.executionUnitId, input.deviceKeyId,
    String(input.elapsedRealtimeMs), String(input.bootCount), String(input.sequence), input.previousLocalHash ?? '', input.markedAt,
  ].join('\n');
}

export function hashRepPOfflineEvent(canonical: string) {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function repPDeviceKeyId(publicKeyBase64: string) {
  const bytes = Buffer.from(publicKeyBase64, 'base64');
  if (bytes.length < 64 || bytes.length > 512) throw new TypeError('Chave pública do aparelho inválida.');
  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new TypeError('Chave pública do aparelho inválida.');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyRepPOfflineEvidence(input: Parameters<typeof canonicalRepPOfflineEvent>[0] & {
  publicKeyBase64: string; localHash: string; signature: string;
}) {
  try {
    const canonical = canonicalRepPOfflineEvent(input);
    if (hashRepPOfflineEvent(canonical) !== input.localHash) return false;
    const key = createPublicKey({ key: Buffer.from(input.publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    return verify('sha256', Buffer.from(canonical, 'utf8'), key, Buffer.from(input.signature, 'base64'));
  } catch {
    return false;
  }
}

export function deriveRepPOfflineMarkedAt(input: {
  anchorInstant: string; anchorElapsedRealtimeMs: number; elapsedRealtimeMs: number; timeZone: string;
}) {
  const anchor = Date.parse(input.anchorInstant);
  const elapsed = input.elapsedRealtimeMs - input.anchorElapsedRealtimeMs;
  if (!Number.isFinite(anchor) || !Number.isSafeInteger(input.anchorElapsedRealtimeMs)
    || !Number.isSafeInteger(input.elapsedRealtimeMs) || elapsed < 0 || elapsed > REP_P_OFFLINE_PERMIT_TTL_MS) {
    throw new TypeError('Âncora temporal offline inválida.');
  }
  return formatRepPAfdTimestamp(new Date(anchor + elapsed), input.timeZone);
}
