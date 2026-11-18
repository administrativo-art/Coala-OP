import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
process.env.BIZNEO_TOKEN = 'integration-test-token';
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { listEditableScheduleShifts, stageScheduleDayOff, stageWorkShift, publishPreparedSchedule, publishSchedule } =
  await import('../../src/features/dp/schedules/publication-service.server.ts');
const { dayOffOperationRef, publishDayOff } = await import('../../src/features/dp/day-offs/service.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

test('DSR substitui turno legado apenas na publicação e permite retomar o envio ao Bizneo', async () => {
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
    dbAdmin.collection('users').doc(userId).set({ username: 'Person', unitId, unitIds: [unitId], isActive: true, registrationIdBizneo: '12345' }),
    dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published',
      name: 'Journey', validFrom: '2027-01-01', weeklyMinutes: 1800, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 360, isRestDay: false }],
      applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
  ]);
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.length, 2);
  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'first', requestId: 'update', mode: 'update',
    input: { userId, unitId, date: first.date, startTime: '08:00', endTime: '15:00' } });
  const dayOff = { userId, unitId, date: second.date };
  await assert.rejects(stageScheduleDayOff(context, schedule.id,
    { ...dayOff, action: 'add', expectedDraftVersion: 1 }, 'still-in-draft'),
  { code: 'DP_DAY_OFF_DRAFT_CONFLICT' });
  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'second', requestId: 'delete', mode: 'delete' });
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.length, 2);
  await stageScheduleDayOff(context, schedule.id, { ...dayOff, action: 'add', expectedDraftVersion: 2 }, 'stage');
  const draft = await listEditableScheduleShifts(context, schedule.id);
  assert.equal(draft.shifts.find((shift) => shift.date === second.date)?.dayOffDraft, true);
  const before = await readOfficialScheduleShifts({ scheduleId: schedule.id });
  assert.equal(before.shifts.find((shift) => shift.date === second.date)?.type, 'work');

  await stageScheduleDayOff(context, schedule.id, { ...dayOff, action: 'remove', expectedDraftVersion: 3 }, 'unstage');
  const withoutDayOff = await listEditableScheduleShifts(context, schedule.id);
  assert.equal(withoutDayOff.shifts.some((shift) => shift.date === second.date), false);
  await stageScheduleDayOff(context, schedule.id, { ...dayOff, action: 'add', expectedDraftVersion: 4 }, 'restage');

  const otherUnitId = `${prefix}-other-unit`;
  const otherUnit = dbAdmin.collection('dp_units').doc(otherUnitId);
  const otherSchedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-other-schedule`);
  const otherShift = otherSchedule.collection('shifts').doc('overlap');
  await Promise.all([
    otherUnit.set({ name: 'Unidade B' }),
    otherSchedule.set({ workspaceId, unitId: otherUnitId, year: 2027, month: 11 }),
    otherShift.set({ ...second, scheduleId: otherSchedule.id, unitId: otherUnitId }),
  ]);
  try {
    await assert.rejects(publishSchedule(context, schedule.id, 'publish-overlap', 5), {
      code: 'DP_PUBLICATION_OCCUPANCY_CONFLICT',
      message: 'O DSR de 04/11/2027 conflita com um turno em Unidade B, das 08:00 às 14:00.',
    });
  } finally {
    await Promise.all([otherShift.delete(), otherSchedule.delete(), otherUnit.delete()]);
  }

  const oldOperation = dayOffOperationRef(workspaceId, userId, second.date);
  await oldOperation.set({ workspaceId, userId, date: second.date, status: 'removed',
    scheduleId: otherSchedule.id, unitId: otherUnitId, shiftId: `day-off-${oldOperation.id.slice(0, 20)}` });
  try {
    await assert.rejects(publishSchedule(context, schedule.id, 'publish-old-operation', 5), {
      code: 'DP_DAY_OFF_DRAFT_OPERATION_CONFLICT',
    });
    assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).revisionId, null);
  } finally {
    await oldOperation.delete();
  }

  await assert.rejects(publishPreparedSchedule(context, schedule.id, 'publish-interrupted', 5,
    async () => { throw new Error('interrupted after preparation'); }), /interrupted after preparation/);
  const publisher = { ...context, decoded: { uid: `${prefix}-second-admin` } };
  const result = await publishSchedule(publisher, schedule.id, 'publish-legacy', 5);
  assert.equal(result.publicationVersion, 2);
  assert.deepEqual(result.dayOffsToSync, [{ ...dayOff, source: 'retry' }]);
  assert.equal((await schedule.collection('shifts').get()).size, 2);
  const official = async () => (await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts;
  const published = await official();
  assert.equal(published.find((shift) => shift.id === 'first')?.endTime, '15:00');
  assert.equal(published.find((shift) => shift.id === 'second'), undefined);
  const pending = published.find((shift) => shift.date === second.date);
  assert.equal(pending?.type, 'day_off');
  assert.equal(pending?.bizneoSyncStatus, 'pending');
  assert.equal(pending?.dayOffDraft, undefined);

  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:/);
    if (init?.method === 'POST') {
      sends += 1;
      return new Response('{}', { status: sends === 1 ? 503 : 201 });
    }
    return Response.json({ day_details: [{
      date: second.date, kind: sends < 2 ? 'schedule' : 'one_time_rest', absences: [], time_ranges: [],
    }] });
  };
  try {
    const sync = () => publishDayOff({ context, scheduleId: schedule.id, input: result.dayOffsToSync[0], requestId: 'sync' });
    await assert.rejects(sync(), { code: 'BIZNEO_DAY_OFF_TEMPORARILY_UNAVAILABLE' });
    assert.equal((await official()).find((shift) => shift.id === pending.id)?.bizneoSyncStatus, 'failed');
    assert.equal((await sync()).dayOff.bizneoSyncStatus, 'published');
    assert.equal((await sync()).alreadyPublished, true);
    assert.equal(sends, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
