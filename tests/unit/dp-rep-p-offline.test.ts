import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';

import { canonicalRepPOfflineEvent, deriveRepPOfflineMarkedAt, hashRepPOfflineEvent,
  repPDeviceKeyId, verifyRepPOfflineEvidence } from '@/features/dp/rep-p/offline';
import { repPMarkingSchema, repPOfflinePermitSchema } from '@/features/dp/rep-p/schemas';

describe('contingência offline do REP-P', () => {
  it('deriva a hora pela âncora monotônica e verifica a assinatura do aparelho', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const deviceKeyId = repPDeviceKeyId(publicKeyBase64);
    const event = { permitId: 'permit-a', attemptId: 'attempt-a', executionUnitId: 'unit-a', deviceKeyId,
      elapsedRealtimeMs: 1_801_000, bootCount: 7, sequence: 1, previousLocalHash: null,
      markedAt: deriveRepPOfflineMarkedAt({ anchorInstant: '2026-10-18T11:00:00.000Z',
        anchorElapsedRealtimeMs: 1_000, elapsedRealtimeMs: 1_801_000, timeZone: 'America/Manaus' }) };
    assert.equal(event.markedAt, '2026-10-18T07:30:00-0400');
    const canonical = canonicalRepPOfflineEvent(event);
    const localHash = hashRepPOfflineEvent(canonical);
    const signature = sign('sha256', Buffer.from(canonical), privateKey).toString('base64');
    assert.equal(verifyRepPOfflineEvidence({ ...event, publicKeyBase64, localHash, signature }), true);
    assert.equal(verifyRepPOfflineEvidence({ ...event, sequence: 2, publicKeyBase64, localHash, signature }), false);
  });

  it('aceita offline só no canal mobile e exige chave segura no pedido', () => {
    const evidence = { permitId: 'permit-a', deviceKeyId: 'a'.repeat(64), elapsedRealtimeMs: 2,
      bootCount: 1, sequence: 1, previousLocalHash: null, markedAt: '2026-10-18T07:30:00-0400',
      localHash: 'b'.repeat(64), signature: Buffer.alloc(64, 1).toString('base64') };
    assert.equal(repPMarkingSchema.safeParse({ attemptId: 'attempt-a', workDate: '2026-10-18',
      executionUnitId: 'unit-a', channel: 'mobile', offline: evidence }).success, true);
    assert.equal(repPMarkingSchema.safeParse({ attemptId: 'attempt-a', workDate: '2026-10-18',
      executionUnitId: 'unit-a', channel: 'browser', offline: evidence }).success, false);
    assert.equal(repPOfflinePermitSchema.safeParse({ permitRequestId: 'request-a', workDate: '2026-10-18',
      installationId: '11111111-1111-4111-8111-111111111111', deviceKeyId: 'a'.repeat(64),
      devicePublicKey: Buffer.alloc(80, 1).toString('base64'), keySecurity: 'software', bootCount: 1,
      anchorElapsedRealtimeMs: 1 }).success, false);
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey
      .export({ format: 'der', type: 'spki' }).toString('base64');
    assert.throws(() => repPDeviceKeyId(p384), /Chave pública do aparelho inválida/);
  });
});
