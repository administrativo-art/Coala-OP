import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateRepPLocation, repPLocationDistanceMeters, repPLocationEvidenceDigest,
  type RepPLocationPolicySnapshot } from '../../src/features/dp/rep-p/location';

function policy(overrides: Partial<RepPLocationPolicySnapshot> = {}): RepPLocationPolicySnapshot {
  return { schemaVersion: 1, workspaceId: 'workspace', executionUnitId: 'unit', revision: 1, mode: 'observe',
    center: { latitude: -1.4558, longitude: -48.4902 }, radiusMeters: 150, maxAccuracyMeters: 100,
    maxAgeSeconds: 60, captureTimeoutMs: 10_000, privacyNoticeUrl: 'https://example.test/privacidade',
    legalBasisReference: 'Aditivo LGPD aprovado', retentionDays: 1_825,
    participantUserIds: ['employee-1'],
    activatedAt: '2026-10-22T12:00:00.000Z', activatedBy: 'admin', ...overrides };
}

const now = new Date('2026-10-22T12:00:30.000Z');
function captured(latitude: number, longitude: number, accuracyMeters: number) {
  return { captureId: 'capture-1', status: 'captured' as const, capturedAt: '2026-10-22T12:00:20.000Z',
    latitude, longitude, accuracyMeters, elapsedMs: 900 };
}

test('distância de Haversine é simétrica e nula no mesmo ponto', () => {
  const a = { latitude: -1.4558, longitude: -48.4902 };
  const b = { latitude: -1.4562, longitude: -48.4894 };
  assert.equal(repPLocationDistanceMeters(a, a), 0);
  assert.ok(Math.abs(repPLocationDistanceMeters(a, b) - repPLocationDistanceMeters(b, a)) < 0.000001);
});

test('classificação conservadora considera o círculo de precisão', () => {
  assert.equal(evaluateRepPLocation(policy(), captured(-1.4558, -48.4902, 15), now).evaluation, 'inside');
  const aboutTwoHundredMeters = captured(-1.4540, -48.4902, 75);
  assert.equal(evaluateRepPLocation(policy(), aboutTwoHundredMeters, now).evaluation, 'indeterminate');
  const farther = captured(-1.4525, -48.4902, 20);
  assert.equal(evaluateRepPLocation(policy(), farther, now).evaluation, 'outside');
});

test('falha, leitura antiga, futura ou imprecisa nunca vira outside automaticamente', () => {
  assert.equal(evaluateRepPLocation(policy(), { captureId: 'denied', status: 'denied', elapsedMs: 12 }, now).evaluation, 'indeterminate');
  assert.equal(evaluateRepPLocation(policy(), { ...captured(-1.4558, -48.4902, 10), capturedAt: '2026-10-22T11:58:00.000Z' }, now).reason, 'capture_stale');
  assert.equal(evaluateRepPLocation(policy(), { ...captured(-1.4558, -48.4902, 10), capturedAt: '2026-10-22T12:02:00.000Z' }, now).reason, 'capture_future');
  assert.equal(evaluateRepPLocation(policy(), captured(-1.4558, -48.4902, 150), now).reason, 'accuracy_exceeded');
});

test('política desligada não solicita localização e digest é determinístico', () => {
  assert.equal(evaluateRepPLocation(policy({ mode: 'disabled' }), captured(-1.4558, -48.4902, 10), now).evaluation, 'not_requested');
  const input = { markingId: 'm1', latitude: -1.4558 };
  assert.equal(repPLocationEvidenceDigest(input), repPLocationEvidenceDigest(input));
  assert.notEqual(repPLocationEvidenceDigest(input), repPLocationEvidenceDigest({ ...input, latitude: -1.4 }));
});
