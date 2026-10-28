import { createHash, createPublicKey, verify } from 'node:crypto';

import { formatRepPAfdTimestamp } from './clock';

export const REP_P_OFFLINE_PERMIT_TTL_MS = 12 * 60 * 60 * 1000;
export const REP_P_OFFLINE_PREPARATION_TTL_MS = 24 * 60 * 60 * 1000;
export const REP_P_OFFLINE_CYCLE_TTL_MS = 24 * 60 * 60 * 1000;

export type RepPOfflineCycleEvidence = Readonly<{ id: string; startedElapsedRealtimeMs: number }>;
export const REP_P_OFFLINE_MAX_PENDING = 20;

export type RepPOfflineEvidence = Readonly<{
  scope?: 'official' | 'pilot';
  permitId: string;
  deviceKeyId: string;
  elapsedRealtimeMs: number;
  bootCount: number;
  sequence: number;
  previousLocalHash: string | null;
  markedAt: string;
  localHash: string;
  signature: string;
  cycle?: RepPOfflineCycleEvidence;
}>;

export function canonicalRepPOfflineEvent(input: {
  scope?: 'official' | 'pilot';
  permitId: string;
  attemptId: string;
  executionUnitId: string;
  deviceKeyId: string;
  elapsedRealtimeMs: number;
  bootCount: number;
  sequence: number;
  previousLocalHash: string | null;
  markedAt: string;
  cycle?: RepPOfflineCycleEvidence;
}) {
  const cycle = input.cycle;
  return [
    `coala-rep-p${input.scope === 'pilot' ? '-pilot' : ''}-offline-v${cycle ? 2 : 1}`,
    input.permitId, input.attemptId, input.executionUnitId, input.deviceKeyId,
    String(input.elapsedRealtimeMs), String(input.bootCount), String(input.sequence), input.previousLocalHash ?? '', input.markedAt,
    ...(cycle ? [cycle.id, String(cycle.startedElapsedRealtimeMs)] : []),
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
  maxElapsedMs?: number;
}) {
  const anchor = Date.parse(input.anchorInstant);
  const elapsed = input.elapsedRealtimeMs - input.anchorElapsedRealtimeMs;
  if (!Number.isFinite(anchor) || !Number.isSafeInteger(input.anchorElapsedRealtimeMs)
    || !Number.isSafeInteger(input.elapsedRealtimeMs) || elapsed < 0 || elapsed > (input.maxElapsedMs ?? REP_P_OFFLINE_PERMIT_TTL_MS)) {
    throw new TypeError('Âncora temporal offline inválida.');
  }
  return formatRepPAfdTimestamp(new Date(anchor + elapsed), input.timeZone);
}

export function offlineCycleWindow(input: { anchorInstant: string; anchorElapsedRealtimeMs: number;
  startedElapsedRealtimeMs: number; elapsedRealtimeMs: number; preparationExpiresAt: string }) {
  const anchor = Date.parse(input.anchorInstant);
  const startDelta = input.startedElapsedRealtimeMs - input.anchorElapsedRealtimeMs;
  const currentDelta = input.elapsedRealtimeMs - input.anchorElapsedRealtimeMs;
  if (!Number.isFinite(anchor) || !Number.isSafeInteger(input.startedElapsedRealtimeMs)
    || !Number.isSafeInteger(input.elapsedRealtimeMs) || startDelta < 0 || startDelta > REP_P_OFFLINE_PREPARATION_TTL_MS
    || currentDelta < startDelta || currentDelta - startDelta > REP_P_OFFLINE_CYCLE_TTL_MS
    || !Number.isFinite(Date.parse(input.preparationExpiresAt)) || anchor + startDelta > Date.parse(input.preparationExpiresAt)) {
    throw new TypeError('Janela do ciclo offline inválida.');
  }
  return { startedAt: anchor + startDelta, capturedAt: anchor + currentDelta,
    expiresAt: anchor + startDelta + REP_P_OFFLINE_CYCLE_TTL_MS };
}

export function canonicalRepPCycleAction(input: { action: 'online' | 'close'; scope: 'official' | 'pilot';
  permitId: string; cycleId: string; startedElapsedRealtimeMs: number; elapsedRealtimeMs: number;
  bootCount: number; deviceKeyId: string; receiptId: string; lastSequence: number }) {
  return [`coala-rep-p-${input.scope}-cycle-v2`, input.action, input.permitId, input.cycleId,
    String(input.startedElapsedRealtimeMs), String(input.elapsedRealtimeMs), String(input.bootCount), input.deviceKeyId,
    input.receiptId, String(input.lastSequence)].join('\n');
}
