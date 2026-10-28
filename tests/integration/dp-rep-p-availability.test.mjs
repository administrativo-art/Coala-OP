import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { repPDbAdmin: repDb } = await import('../../src/lib/firebase-rep-p-admin.ts');
const { checkRepPCollectorAvailability, recordRepPAvailabilityNotification } =
  await import('../../src/features/dp/rep-p/availability.server.ts');
const { generateRepPAfd, serializeRepPAfdEvent } = await import('../../src/features/dp/rep-p/afd.ts');

const clock = { async read() { return {
  instant: new Date('2026-10-27T12:00:00Z'), source: 'synthetic-hlb-test',
  assurance: 'hlb_verified', observedOffsetMs: 12, verifiedAt: new Date(),
  attestationId: 'a'.repeat(64), attestationMode: 'fresh', quorum: 2,
  observations: [
    { server: '200.20.186.75', status: 'accepted', offsetMs: 10, roundTripMs: 20, stratum: 1 },
    { server: '200.20.186.94', status: 'accepted', offsetMs: 14, roundTripMs: 22, stratum: 1 },
  ],
}; } };
const notification = (incidentId, state) => ({ incidentId, state,
  startedAt: 1793098800, ...(state === 'closed' ? { endedAt: 1793099100 } : {}),
  policyName: 'synthetic-policy', conditionName: 'synthetic-condition' });

test('monitoração: gate fechado não acessa banco ou relógio; sonda detecta falhas sem escrever', async () => {
  const forbidden = { collection() { throw new Error('unexpected database access'); } };
  const unavailableClock = { async read() { throw new Error('synthetic clock outage'); } };
  assert.deepEqual(await recordRepPAvailabilityNotification('synthetic-workspace', notification('closed-gate', 'open'),
    { repDb: forbidden, clock: unavailableClock, markingEnabled: false }),
  { status: 'official-collection-disabled', establishments: 0, events: 0 });
  assert.equal((await checkRepPCollectorAvailability({ repDb, clock })).status, 'ok');
  await assert.rejects(checkRepPCollectorAvailability({ repDb, clock: unavailableClock }), /synthetic clock outage/);
  await assert.rejects(checkRepPCollectorAvailability({ repDb: forbidden, clock }), /unexpected database access/);
  const untrustedClock = { async read() { return { ...(await clock.read()), assurance: 'unverified' }; } };
  await assert.rejects(checkRepPCollectorAvailability({ repDb, clock: untrustedClock }));
  assert.equal((await checkRepPCollectorAvailability({ repDb, clock })).status, 'ok');
});

test('incidentes persistidos: concorrência, replay, ordem invertida e exportação AFD sem NSR duplicado', async () => {
  const workspaceId = 'synthetic-availability-workspace';
  const establishmentId = 'synthetic-availability-establishment';
  const establishment = repDb.collection('repP_establishments').doc(establishmentId);
  const deps = { repDb, clock, markingEnabled: true };
  const deliver = (id, state) => recordRepPAvailabilityNotification(workspaceId, notification(id, state), deps);
  const events = () => repDb.collection('repP_events').where('establishmentId', '==', establishmentId).get();
  try {
    await establishment.set({ schemaVersion: 1, workspaceId, establishmentId, status: 'ready',
      timeZone: 'America/Belem', lastNsr: 0 });
    const opened = await Promise.all([deliver('incident-a', 'open'), deliver('incident-a', 'open')]);
    assert.equal(opened.reduce((count, item) => count + item.events, 0), 1);
    assert.equal((await deliver('incident-b', 'open')).events, 0);
    assert.equal((await deliver('incident-a', 'closed')).events, 0);
    assert.equal((await deliver('incident-b', 'closed')).events, 1);
    assert.equal((await deliver('incident-b', 'closed')).events, 0);
    assert.equal((await deliver('incident-b', 'open')).events, 0);
    assert.equal((await deliver('incident-c', 'closed')).events, 2);
    assert.equal((await deliver('incident-c', 'open')).events, 0);
    const rows = (await events()).docs.map((doc) => doc.data()).sort((a, b) => a.nsr - b.nsr);
    assert.deepEqual(rows.map((row) => [row.nsr, row.eventCode]), [[1, '08'], [2, '07'], [3, '08'], [4, '07']]);
    assert.equal((await establishment.get()).get('lastNsr'), 4);
    const state = await repDb.collection('repP_availabilityStates').doc(establishmentId).get();
    assert.deepEqual(state.get('openIncidentIds'), []);
    assert.ok(rows.every((row) => row.recordType === '6' && row.trustedClock.attestationMode === 'fresh'
      && row.observedStartedAt.toMillis() === 1793098800000));
    const pkg = generateRepPAfd({
      profile: { establishmentId, employerCnpj: '14276603000125', employerLegalName: 'AMOSTRA SEM VALIDADE',
        inpiRegistration: '1234567890123', developerCnpj: '14276603000125' },
      startDate: '2026-10-27', endDate: '2026-10-27', generatedAt: '2026-10-27T09:00:00-0300', events: rows,
    });
    assert.equal(pkg.counts['6'], 4);
    assert.equal(pkg.counts['7'], 0);
    const lines = pkg.bytes.toString('latin1').split('\r\n');
    for (const row of rows) assert.ok(lines.includes(serializeRepPAfdEvent(row)));
  } finally {
    for (const collection of ['repP_events', 'repP_availabilityIncidents']) {
      const snapshot = await repDb.collection(collection).where('establishmentId', '==', establishmentId).get();
      for (const doc of snapshot.docs) await doc.ref.delete();
    }
    await repDb.collection('repP_availabilityStates').doc(establishmentId).delete();
    await establishment.delete();
  }
});

test('falha da Hora Legal e NSR esgotado não deixam evento parcial nem consomem sequência', async () => {
  const workspaceId = 'synthetic-availability-failure-workspace';
  const establishmentId = 'synthetic-availability-failure-establishment';
  const establishment = repDb.collection('repP_establishments').doc(establishmentId);
  const state = repDb.collection('repP_availabilityStates').doc(establishmentId);
  const deps = { repDb, clock, markingEnabled: true };
  const events = () => repDb.collection('repP_events').where('establishmentId', '==', establishmentId).get();
  const incidents = () => repDb.collection('repP_availabilityIncidents').where('establishmentId', '==', establishmentId).get();
  try {
    await establishment.set({ schemaVersion: 1, workspaceId, establishmentId, status: 'ready',
      timeZone: 'America/Belem', lastNsr: 10 });
    for (const failedClock of [
      { async read() { throw new Error('synthetic clock unavailable'); } },
      { async read() { return { ...(await clock.read()), assurance: 'unverified' }; } },
    ]) {
      await assert.rejects(recordRepPAvailabilityNotification(workspaceId, notification('clock-retry', 'open'),
        { ...deps, clock: failedClock }));
      assert.equal((await establishment.get()).get('lastNsr'), 10);
      assert.equal((await events()).size, 0);
      assert.equal((await incidents()).size, 0);
      assert.equal((await state.get()).exists, false);
    }
    const freshClock = { async read(options) {
      assert.deepEqual(options, { requireFresh: true });
      return clock.read();
    } };
    const recovered = await recordRepPAvailabilityNotification(workspaceId, notification('clock-retry', 'open'),
      { ...deps, clock: freshClock });
    assert.equal(recovered.events, 1);
    assert.equal((await establishment.get()).get('lastNsr'), 11);
    const closed = await recordRepPAvailabilityNotification(workspaceId, notification('clock-retry', 'closed'), deps);
    assert.equal(closed.events, 1);
    assert.deepEqual((await events()).docs.map((doc) => [doc.get('nsr'), doc.get('eventCode')]).sort((a, b) => a[0] - b[0]),
      [[11, '08'], [12, '07']]);

    await establishment.update({ lastNsr: 999_999_999 });
    const previousState = (await state.get()).data();
    const previousIncidents = (await incidents()).size;
    await assert.rejects(recordRepPAvailabilityNotification(workspaceId, notification('exhausted', 'open'), deps),
      { code: 'REP_P_NSR_EXHAUSTED' });
    assert.equal((await establishment.get()).get('lastNsr'), 999_999_999);
    assert.equal((await events()).size, 2);
    assert.equal((await incidents()).size, previousIncidents);
    assert.deepEqual((await state.get()).data(), previousState);
  } finally {
    for (const collection of ['repP_events', 'repP_availabilityIncidents']) {
      const rows = await repDb.collection(collection).where('establishmentId', '==', establishmentId).get();
      for (const doc of rows.docs) await doc.ref.delete();
    }
    await state.delete();
    await establishment.delete();
  }
});
