import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { applyActiveRevisionOperationalChanges } = await import('../../src/features/dp/schedules/operational-overlay.server.ts');
const { readOfficialScheduleShifts, readOfficialPersonMonth, readOfficialScheduleShiftsInTransaction } = await import('../../src/features/dp/schedules/official-revision.server.ts');
const { listScheduleShifts } = await import('../../src/features/dp/schedules/read-service.server.ts');
const { capturePublicationFence } = await import('../../src/features/dp/schedules/publication-fence.server.ts');

test('troca operacional altera somente overlay ativo e indexa nova pessoa atomicamente', async () => {
  const schedule = dbAdmin.collection('dp_schedules').doc('overlay-integration-schedule');
  const revisionId = 'rev-1';
  const original = { scheduleId: schedule.id, unitId: 'overlay-unit', userId: 'overlay-old',
    date: '2027-11-12', type: 'work', startTime: '09:00', endTime: '15:00' };
  const next = { ...original, userId: 'overlay-new' };
  const indexId = createHash('sha256').update('overlay-new:2027-11').digest('hex');
  await Promise.all([
    schedule.set({ year: 2027, month: 11, unitId: 'overlay-unit', workspaceId: 'overlay-workspace', activeRevisionId: revisionId,
      publicationStatus: 'published', publicationVersion: 1, operationalVersion: 0, shiftCount: 1 }),
    schedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: schedule.id }),
    schedule.collection('revisions').doc(revisionId).collection('entries').doc('one').set(original),
    schedule.collection('revisions').doc(revisionId).collection('people').doc('overlay-old').set({ shifts: [{ id: 'one', ...original }] }),
  ]);
  await dbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(schedule);
    await applyActiveRevisionOperationalChanges({ tx, schedule: snapshot, workspaceId: 'overlay-workspace',
      changes: [{ shiftId: 'one', previous: original, next }], actorId: 'test-actor', reason: 'shift_swap_accepted' });
  });
  assert.equal((await schedule.get()).get('operationalVersion'), 1);
  const fence = await capturePublicationFence('overlay-workspace', ['overlay-old', 'overlay-new']);
  assert.ok([...fence.values()].every((version) => version === 1));
  assert.equal((await schedule.collection('revisions').doc(revisionId).collection('entries').doc('one').get()).get('userId'), 'overlay-old');
  assert.deepEqual((await readOfficialScheduleShifts({ scheduleId: schedule.id, userId: 'overlay-old' })).shifts, []);
  assert.deepEqual((await readOfficialScheduleShifts({ scheduleId: schedule.id, userId: 'overlay-new' })).shifts.map((shift) => shift.id), ['one']);
  assert.deepEqual((await readOfficialPersonMonth({ userId: 'overlay-new', competence: '2027-11' })).shifts.map((shift) => shift.id), ['one']);
  const transactional = await dbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(schedule);
    return readOfficialScheduleShiftsInTransaction(tx, snapshot, { userId: 'overlay-new' });
  });
  assert.deepEqual(transactional.map((shift) => shift.id), ['one']);
  assert.deepEqual((await listScheduleShifts({ isDefaultAdmin: true, userDoc: {}, permissions: {} }, schedule.id))
    .map((shift) => shift.userId), ['overlay-new']);
  assert.deepEqual((await dbAdmin.collection('dp_personScheduleIndex').doc(indexId).get()).get('scheduleIds'), [schedule.id]);
  await assert.rejects(dbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(schedule);
    await applyActiveRevisionOperationalChanges({ tx, schedule: snapshot, workspaceId: 'overlay-workspace',
      changes: [{ shiftId: 'one', previous: original, next }], actorId: 'test-actor', reason: 'stale_retry' });
  }), { code: 'DP_OPERATIONAL_SHIFT_CHANGED' });
});
