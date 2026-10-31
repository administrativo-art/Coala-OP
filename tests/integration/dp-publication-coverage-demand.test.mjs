import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { saveCoverageDemands } = await import('../../src/features/dp/coverage-demands/service.server.ts');
const { publishSchedule } = await import('../../src/features/dp/schedules/publication-service.server.ts');

test('demanda manual permanece em rascunho até a publicação', async () => {
  const scheduleId = 'publication-coverage-schedule';
  const unitId = 'publication-coverage-unit';
  const workspaceId = 'publication-coverage-workspace';
  const schedule = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const context = { decoded: { uid: 'coverage-admin' }, userDoc: { username: 'Admin' }, isDefaultAdmin: true,
    permissions: { dp: { schedules: { view: true, edit: true, publish: true } } }, workspace_id: workspaceId };
  await Promise.all([
    schedule.set({ workspaceId, unitId, year: 2027, month: 11, publicationStatus: 'draft', publicationVersion: 0,
      draftVersion: 0, journeyValidationVersion: 0, operationalVersion: 0, shiftCount: 0, createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unit', coverageMode: 'on_demand', isArchived: false }),
  ]);
  const windows = [{ startTime: '08:00', endTime: '14:00', minimumPeople: 2, reason: 'Demanda' }];
  await saveCoverageDemands({ context, scheduleId, date: '2027-11-01', input: { unitId, windows }, requestId: 'draft-demand' });
  const before = await schedule.get();
  assert.equal(before.get('publicationStatus'), 'draft');
  assert.equal(before.get('coverageDemands'), undefined);
  assert.deepEqual(before.get('draftCoverageDemands.2027-11-01'), windows);
  assert.equal(before.get('draftVersion'), 1);
  await publishSchedule(context, scheduleId, 'publish-demand', 1);
  const after = await schedule.get();
  assert.equal(after.get('publicationStatus'), 'published');
  assert.deepEqual(after.get('coverageDemands.2027-11-01'), windows);
  assert.equal(after.get('draftCoverageDemands'), undefined);
});
