import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { hrDbAdmin: journeyDb } = await import('../../src/lib/firebase-rh-admin.ts');
const { repPDbAdmin: policyDb } = await import('../../src/lib/firebase-rep-p-admin.ts');
const { recordOwnJourneyLocation, JOURNEY_LOCATION_EVENTS, JOURNEY_LOCATION_SESSIONS } =
  await import('../../src/features/dp/rep-p/journey-location.server.ts');
const { repPLocationPolicyRef } = await import('../../src/features/dp/rep-p/location-policy.server.ts');

test('jornada no emulador: início, pausa, retomada, encerramento e revogação sem coordenada tardia', async () => {
  const workspaceId = 'synthetic-journey-workspace';
  const employeeId = 'synthetic-journey-employee';
  const unitId = 'synthetic-journey-unit';
  const context = { workspace_id: workspaceId, decoded: { uid: employeeId }, userDoc: { id: employeeId } };
  const policyRef = repPLocationPolicyRef(policyDb, workspaceId, unitId);
  const policy = { schemaVersion: 1, workspaceId, executionUnitId: unitId, revision: 1, mode: 'observe',
    center: { latitude: -1.455, longitude: -48.49 }, radiusMeters: 100, maxAccuracyMeters: 100,
    maxAgeSeconds: 120, captureTimeoutMs: 10_000, privacyNoticeUrl: 'https://example.test/privacy',
    legalBasisReference: 'SYNTHETIC TEST POLICY', retentionDays: 1825, participantUserIds: [employeeId],
    activatedAt: '2026-10-27T00:00:00Z', activatedBy: 'synthetic-admin' };
  const shift = { date: '2026-10-27', type: 'work', startTime: '08:00', endTime: '16:00', overnight: false,
    unitId, unitTimeZone: 'America/Belem', executionUnitPolicy: 'free', locationTrackingPolicy: 'workday' };
  const deps = { repDb: journeyDb, policyDb, enabled: true, now: () => new Date('2026-10-27T20:00:00Z'),
    readMonth: async () => ({ month: '2026-10', shifts: [shift], holidays: [], truncated: false }) };
  const sessionId = '20000000-0000-4000-8000-000000000001';
  let sequence = 0;
  const event = (eventType, hour, session = sessionId) => ({
    eventId: `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    sessionId: session, workDate: '2026-10-27', executionUnitId: unitId, eventType,
    capturedAt: `2026-10-27T${hour}:00-03:00`,
    ...(eventType === 'sample' ? { latitude: -1.455, longitude: -48.49, accuracyMeters: 20 } : {}),
  });
  const rows = (collection) => journeyDb.collection(collection).where('employeeId', '==', employeeId).get();
  try {
    await policyRef.set(policy);
    const start = event('start', '08:00');
    await recordOwnJourneyLocation(context, { events: [start, event('sample', '09:00'), event('pause', '12:00')] }, deps);
    assert.equal((await rows(JOURNEY_LOCATION_EVENTS)).size, 3);
    await assert.rejects(recordOwnJourneyLocation(context, { events: [event('sample', '12:30')] }, deps));
    assert.equal((await rows(JOURNEY_LOCATION_EVENTS)).size, 3);
    const finish = [event('resume', '13:00'), event('sample', '14:00'), event('stop', '16:00')];
    await recordOwnJourneyLocation(context, { events: finish }, deps);
    await recordOwnJourneyLocation(context, { events: finish }, deps);
    assert.equal((await rows(JOURNEY_LOCATION_EVENTS)).size, 6);
    await assert.rejects(recordOwnJourneyLocation(context, { events: [event('sample', '16:01')] }, deps));
    const session = (await rows(JOURNEY_LOCATION_SESSIONS)).docs[0];
    assert.equal(session.get('state'), 'stopped');
    const session2 = '20000000-0000-4000-8000-000000000002';
    await recordOwnJourneyLocation(context, { events: [event('start', '08:00', session2)] }, deps);
    await policyRef.update({ mode: 'disabled', participantUserIds: [] });
    const late = event('sample', '09:00', session2);
    const revoked = await recordOwnJourneyLocation(context, { events: [late] }, deps);
    assert.equal(revoked.stopRequested, true);
    assert.equal((await rows(JOURNEY_LOCATION_EVENTS)).size, 7);
    const disabled = await recordOwnJourneyLocation(context, { events: [late] }, { ...deps, enabled: false });
    assert.equal(disabled.stopRequested, true);
    assert.equal((await rows(JOURNEY_LOCATION_EVENTS)).size, 7);
    for (const row of (await rows(JOURNEY_LOCATION_EVENTS)).docs) assert.ok(row.get('expiresAt'));
  } finally {
    for (const collection of [JOURNEY_LOCATION_EVENTS, JOURNEY_LOCATION_SESSIONS]) {
      for (const row of (await rows(collection)).docs) await row.ref.delete();
    }
    await policyRef.delete();
  }
});
