import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { stageWorkShift, publishSchedule } =
  await import('../../src/features/dp/schedules/publication-service.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

test('escala legada sem status permanece oficial até a publicação de revisão', async () => {
  const prefix = 'publication-legacy';
  const workspaceId = `${prefix}-workspace`;
  const unitId = `${prefix}-unit`;
  const userId = `${prefix}-person`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  const journeyId = `${prefix}-journey`;
  const context = { decoded: { uid: `${prefix}-admin` }, userDoc: { username: 'Admin' },
    isDefaultAdmin: true, permissions: { dp: { schedules: { view: true, edit: true, publish: true } } }, workspace_id: workspaceId };
  const first = { scheduleId: schedule.id, unitId, userId, type: 'work', date: '2027-11-01',
    startTime: '08:00', endTime: '14:00' };
  const second = { ...first, date: '2027-11-04' };
  await Promise.all([
    schedule.set({ workspaceId, unitId, year: 2027, month: 11, shiftCount: 2,
      journeyValidationVersion: 0, createdAt: new Date() }),
    schedule.collection('shifts').doc('first').set(first), schedule.collection('shifts').doc('second').set(second),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unit', isArchived: false }),
    dbAdmin.collection('users').doc(userId).set({ username: 'Person', unitId, unitIds: [unitId], isActive: true }),
    dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published',
      name: 'Journey', validFrom: '2027-01-01', weeklyMinutes: 1800, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 360, isRestDay: false }],
      applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
  ]);
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.length, 2);
  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'first', requestId: 'update', mode: 'update',
    input: { userId, unitId, date: first.date, startTime: '08:00', endTime: '15:00' } });
  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'second', requestId: 'delete', mode: 'delete' });
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.length, 2);
  const result = await publishSchedule(context, schedule.id, 'publish-legacy', 2);
  assert.equal(result.publicationVersion, 2);
  assert.equal((await schedule.collection('shifts').get()).size, 2);
  const official = (await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts;
  assert.deepEqual(official.map((shift) => shift.id), ['first']);
  assert.equal(official[0].endTime, '15:00');
});
