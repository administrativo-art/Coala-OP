import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { stageBulkWorkShift, listEditableScheduleShifts } =
  await import('../../src/features/dp/schedules/publication-service.server.ts');

test('500 draft changes stay outside the official schedule and are scoped to one generation', async () => {
  const scheduleId = 'draft-generation-500';
  const unitId = 'draft-generation-unit';
  const definitionId = 'draft-generation-definition';
  const schedule = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const context = { decoded: { uid: 'draft-editor' }, userDoc: { username: 'Editor' },
    isDefaultAdmin: true, permissions: { dp: { schedules: { view: true, edit: true, publish: true } } },
    workspace_id: 'draft-generation-workspace' };
  await Promise.all([
    schedule.set({ workspaceId: context.workspace_id, unitId, year: 2027, month: 11,
      publicationStatus: 'draft', publicationVersion: 0, draftVersion: 0, shiftCount: 0 }),
    dbAdmin.collection('dp_shiftDefinitions').doc(definitionId).set({ name: 'Test shift' }),
    ...Array.from({ length: 20 }, (_, index) => dbAdmin.collection('users').doc(`draft-person-${index}`)
      .set({ isActive: true, username: `Person ${index}`, unitId })),
  ]);
  const all = Array.from({ length: 500 }, (_, index) => ({ userId: `draft-person-${Math.floor(index / 25)}`,
    date: `2027-11-${String(index % 25 + 1).padStart(2, '0')}` }));
  for (let offset = 0; offset < all.length; offset += 200) {
    await stageBulkWorkShift({ context, scheduleId, requestId: `draft-bulk-${offset}`,
      input: { action: 'create', shiftDefinitionId: definitionId, startTime: '08:00', endTime: '14:00',
        entries: all.slice(offset, offset + 200) } });
  }
  assert.equal((await schedule.collection('shifts').get()).size, 0);
  assert.equal((await listEditableScheduleShifts(context, scheduleId)).shifts.length, 500);
  const snapshot = await schedule.get();
  assert.equal(snapshot.get('draftVersion'), 3);
  assert.equal((await schedule.collection('draftEdits').where('generationId', '==', 'initial').get()).size, 500);
  await schedule.update({ draftGenerationId: 'next-generation', draftVersion: 0 });
  assert.equal((await listEditableScheduleShifts(context, scheduleId)).shifts.length, 0);
});
