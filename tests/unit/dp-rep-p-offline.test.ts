import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';

import { canonicalRepPOfflineEvent, deriveRepPOfflineMarkedAt, hashRepPOfflineEvent, offlineCycleWindow,
  repPDeviceKeyId, verifyRepPOfflineEvidence } from '@/features/dp/rep-p/offline';
import { repPMarkingSchema, repPOfflinePermitSchema } from '@/features/dp/rep-p/schemas';

describe('contingência offline do REP-P', () => {
  it('separa o preparo de 24 horas do ciclo de 24 horas com limites no milissegundo bruto', () => {
    const hour = 3_600_000;
    const anchor = Date.parse('2026-10-27T23:00:00Z');
    const input = { anchorInstant: new Date(anchor).toISOString(), anchorElapsedRealtimeMs: 1000,
      preparationExpiresAt: new Date(anchor + 24 * hour).toISOString(), startedElapsedRealtimeMs: 1000 + 24 * hour,
      elapsedRealtimeMs: 1000 + 48 * hour };
    assert.deepEqual(offlineCycleWindow(input), { startedAt: anchor + 24 * hour, capturedAt: anchor + 48 * hour, expiresAt: anchor + 48 * hour });
    assert.throws(() => offlineCycleWindow({ ...input, elapsedRealtimeMs: input.elapsedRealtimeMs + 1 }));
    assert.throws(() => offlineCycleWindow({ ...input, startedElapsedRealtimeMs: input.startedElapsedRealtimeMs + 1 }));
    assert.throws(() => offlineCycleWindow({ ...input, startedElapsedRealtimeMs: 999 }));
    assert.throws(() => offlineCycleWindow({ ...input, elapsedRealtimeMs: 999 }));
  });

  it('vincula o início e a identidade do ciclo ao canônico v2 sem alterar o domínio v1', () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKeyBase64 = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const event = { permitId: 'permit', attemptId: 'first', executionUnitId: 'unit', deviceKeyId: repPDeviceKeyId(publicKeyBase64),
      bootCount: 1, sequence: 1, previousLocalHash: null, elapsedRealtimeMs: 1000, markedAt: '2026-10-27T20:00:00-0300',
      cycle: { id: 'first', startedElapsedRealtimeMs: 1000 } };
    const canonical = canonicalRepPOfflineEvent(event);
    assert.match(canonical, /^coala-rep-p-offline-v2\n/);
    const proof = { localHash: hashRepPOfflineEvent(canonical), signature: sign('sha256', Buffer.from(canonical), keys.privateKey).toString('base64'), publicKeyBase64 };
    assert.equal(verifyRepPOfflineEvidence({ ...event, ...proof }), true);
    assert.equal(verifyRepPOfflineEvidence({ ...event, ...proof, cycle: { ...event.cycle, startedElapsedRealtimeMs: 1001 } }), false);
    assert.equal(verifyRepPOfflineEvidence({ ...event, ...proof, scope: 'pilot' }), false);
    assert.equal(verifyRepPOfflineEvidence({ ...event, ...proof, cycle: undefined }), false);
  });
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
    const pilotEvent = { ...event, scope: 'pilot' as const };
    const pilotCanonical = canonicalRepPOfflineEvent(pilotEvent);
    const pilotHash = hashRepPOfflineEvent(pilotCanonical);
    const pilotSignature = sign('sha256', Buffer.from(pilotCanonical), privateKey).toString('base64');
    assert.match(pilotCanonical, /^coala-rep-p-pilot-offline-v1\n/);
    assert.equal(verifyRepPOfflineEvidence({ ...pilotEvent, publicKeyBase64, localHash: pilotHash,
      signature: pilotSignature }), true);
    assert.equal(verifyRepPOfflineEvidence({ ...event, publicKeyBase64, localHash: pilotHash,
      signature: pilotSignature }), false, 'a assinatura do ensaio não pode ser promovida ao domínio oficial');
  });

  it('aceita offline só no canal mobile e exige chave segura no pedido', () => {
    const evidence = { permitId: 'permit-a', deviceKeyId: 'a'.repeat(64), elapsedRealtimeMs: 2,
      bootCount: 1, sequence: 1, previousLocalHash: null, markedAt: '2026-10-18T07:30:00-0400',
      localHash: 'b'.repeat(64), signature: Buffer.alloc(64, 1).toString('base64') };
    assert.equal(repPMarkingSchema.safeParse({ attemptId: 'attempt-a', workDate: '2026-10-18',
      executionUnitId: 'unit-a', channel: 'mobile', offline: evidence }).success, true);
    assert.equal(repPMarkingSchema.parse({ attemptId: 'attempt-a', workDate: '2026-10-18',
      executionUnitId: 'unit-a', channel: 'mobile', offline: evidence }).offline?.scope, undefined,
    'o contrato oficial v1 não muda o digest de tentativas antigas');
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
