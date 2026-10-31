import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { stageBulkWorkShift, publishSchedule } =
  await import('../../src/features/dp/schedules/publication-service.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');
const { saveWorkShift } = await import('../../src/features/dp/shifts/service.server.ts');

test('publica 500 turnos de 500 pessoas com ponteiro único, referências e geração inerte', async () => {
  const prefix = 'publication-500';
  const workspaceId = `${prefix}-workspace`;
  const unitId = `${prefix}-unit`;
  const scheduleId = `${prefix}-schedule`;
  const journeyId = `${prefix}-journey`;
  const definitionId = `${prefix}-definition`;
  const schedule = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const context = { decoded: { uid: `${prefix}-admin` }, userDoc: { username: 'DP Admin' },
    isDefaultAdmin: true, permissions: { dp: { schedules: { view: true, edit: true, publish: true } } }, workspace_id: workspaceId };
  await Promise.all([
    schedule.set({ workspaceId, unitId, year: 2027, month: 11, publicationStatus: 'draft',
      publicationVersion: 0, operationalVersion: 0, draftVersion: 0,
      journeyValidationVersion: 0, shiftCount: 0, createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unit', isArchived: false }),
    dbAdmin.collection('dp_shiftDefinitions').doc(definitionId).set({ name: 'Shift', startTime: '08:00', endTime: '14:00',
      breakType: 'fixed', breakStart: '11:00', breakEnd: '11:30', journeyIds: [journeyId] }),
    dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published',
      name: 'Journey', validFrom: '2027-01-01', weeklyMinutes: 1800, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 360, isRestDay: false }],
      applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
    ...Array.from({ length: 500 }, (_, index) => dbAdmin.collection('users').doc(`${prefix}-person-${index}`)
      .set({ username: `Person ${index}`, isActive: true, unitId, unitIds: [unitId],
        needsTransportVoucher: index % 2 === 0, transportVoucherValue: 5.5 })),
  ]);
  const dates = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28];
  await assert.rejects(saveWorkShift({ context, scheduleId, shiftId: 'forbidden-operational', mode: 'create',
    requestId: 'must-not-touch-draft', input: { userId: `${prefix}-person-0`, unitId,
      date: '2027-11-01', startTime: '08:00', endTime: '14:00' } }),
  { code: 'DP_SHIFT_DRAFT_NOT_OPERATIONAL' });
  const entries = Array.from({ length: 500 }, (_, index) => ({ userId: `${prefix}-person-${index}`,
    date: `2027-11-${String(dates[index % 10]).padStart(2, '0')}` }));
  for (let offset = 0; offset < entries.length; offset += 200) {
    await stageBulkWorkShift({ context, scheduleId, requestId: `stage-${offset}`,
      input: { action: 'create', shiftDefinitionId: definitionId, startTime: '08:00', endTime: '14:00',
        entries: entries.slice(offset, offset + 200) } });
  }
  const before = await schedule.get();
  assert.equal(before.get('draftVersion'), 3);
  const result = await publishSchedule(context, scheduleId, 'publish-500', 3);
  assert.equal(result.publicationVersion, 1);
  const after = await schedule.get();
  assert.equal(after.get('publicationStatus'), 'published');
  assert.equal(after.get('shiftCount'), 500);
  assert.notEqual(after.get('draftGenerationId'), 'initial');
  assert.equal((await schedule.collection('shifts').get()).size, 0);
  assert.equal((await readOfficialScheduleShifts({ scheduleId })).shifts.length, 500);
  assert.equal((await schedule.collection('revisions').doc(after.get('activeRevisionId')).get()).get('status'), 'ready');
  assert.equal((await schedule.collection('draftEdits').get()).size, 500);
  assert.equal((await dbAdmin.collection('dp_shiftReferenceHistory').where('scheduleId', '==', scheduleId).get()).size, 500);
  assert.equal(Object.keys(after.get('snapshot.users')).length, 500);
  assert.equal((await publishSchedule(context, scheduleId, 'publish-500', 0)).publicationVersion, 1);
  await assert.rejects(publishSchedule({ ...context, isDefaultAdmin: false,
    permissions: { dp: { schedules: { view: true, edit: true, publish: false } } } }, scheduleId, 'forbidden', 0),
  { code: 'DP_SCHEDULE_DRAFT_FORBIDDEN' });
});
