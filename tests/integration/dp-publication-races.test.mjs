import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { stageWorkShift, publishPreparedSchedule, listEditableScheduleShifts, discardConflictingDraftShifts } =
  await import('../../src/features/dp/schedules/publication-service.server.ts');
const { applyActiveRevisionOperationalChanges } =
  await import('../../src/features/dp/schedules/operational-overlay.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

test('evento operacional não conflitante entra na revisão; alteração do mesmo turno barra a troca do ponteiro', async () => {
  const prefix = 'publication-races';
  const workspaceId = `${prefix}-workspace`;
  const unitId = `${prefix}-unit`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  const revision = schedule.collection('revisions').doc('rev-1');
  const personId = `${prefix}-person`;
  const journeyId = `${prefix}-journey`;
  const context = { decoded: { uid: `${prefix}-admin` }, userDoc: { username: 'Admin' },
    isDefaultAdmin: true, permissions: { dp: { schedules: { view: true, edit: true, publish: true } } }, workspace_id: workspaceId };
  const a = { scheduleId: schedule.id, unitId, userId: personId, userName: 'Person', type: 'work',
    date: '2027-11-01', startTime: '08:00', endTime: '14:00' };
  const b = { ...a, date: '2027-11-04' };
  await Promise.all([
    schedule.set({ workspaceId, unitId, year: 2027, month: 11, publicationStatus: 'published',
      publicationVersion: 1, activeRevisionId: 'rev-1', operationalVersion: 0, draftVersion: 0, journeyValidationVersion: 0,
      shiftCount: 2, createdAt: new Date() }),
    revision.set({ status: 'ready', scheduleId: schedule.id }),
    revision.collection('entries').doc('a').set(a), revision.collection('entries').doc('b').set(b),
    revision.collection('people').doc(personId).set({ shifts: [{ id: 'a', ...a }, { id: 'b', ...b }] }),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unit', isArchived: false }),
    dbAdmin.collection('users').doc(personId).set({ username: 'Person', unitId, unitIds: [unitId], isActive: true }),
    dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published',
      name: 'Journey', validFrom: '2027-01-01', weeklyMinutes: 1800, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 360, isRestDay: false }],
      applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
  ]);
  const input = { userId: personId, unitId, date: a.date, startTime: '08:00', endTime: '15:00' };
  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'a', input, mode: 'update', requestId: 'stage-a' });
  await dbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(schedule);
    await applyActiveRevisionOperationalChanges({ tx, schedule: snapshot, workspaceId,
      changes: [{ shiftId: 'b', previous: b, next: { ...b, date: '2027-11-05' } }],
      actorId: personId, reason: 'shift_swap_accepted' });
  });
  assert.deepEqual((await listEditableScheduleShifts(context, schedule.id)).conflicts, []);
  const first = await publishPreparedSchedule(context, schedule.id, 'publish-a', 1);
  assert.equal(first.publicationVersion, 2);
  const effective = await readOfficialScheduleShifts({ scheduleId: schedule.id });
  assert.equal(effective.shifts.find((shift) => shift.id === 'a').endTime, '15:00');
  assert.equal(effective.shifts.find((shift) => shift.id === 'b').date, '2027-11-05');

  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'a',
    input: { ...input, endTime: '16:00' }, mode: 'update', requestId: 'stage-a-again' });
  const pointerBeforeRace = (await schedule.get()).get('activeRevisionId');
  await assert.rejects(publishPreparedSchedule(context, schedule.id, 'publish-race', 1, async () => {
    await dbAdmin.runTransaction(async (tx) => {
      const snapshot = await tx.get(schedule);
      const currentA = (await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.find((shift) => shift.id === 'a');
      await applyActiveRevisionOperationalChanges({ tx, schedule: snapshot, workspaceId,
        changes: [{ shiftId: 'a', previous: currentA, next: null }],
        actorId: personId, reason: 'absence_activated' });
    });
  }), { code: 'DP_SCHEDULE_PUBLICATION_STALE' });
  assert.equal((await schedule.get()).get('activeRevisionId'), pointerBeforeRace);
  assert.deepEqual((await listEditableScheduleShifts(context, schedule.id)).conflicts, ['a']);
  assert.deepEqual(await discardConflictingDraftShifts(context, schedule.id, 1), { discarded: 1, remaining: 0 });
  assert.deepEqual((await listEditableScheduleShifts(context, schedule.id)).conflicts, []);
  const resolved = await publishPreparedSchedule(context, schedule.id, 'publish-after-discard', 2);
  assert.equal(resolved.publicationVersion, 3);
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.some((shift) => shift.id === 'a'), false);
});
