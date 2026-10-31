import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { prepareScheduleRevision } = await import('../../src/features/dp/schedules/revision-preparation.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

test('500 changed entries prepare in chunks; an interrupted attempt is inert and resumable', async () => {
  const scheduleRef = dbAdmin.collection('dp_schedules').doc('revision-preparation-500');
  const revisionId = 'prepared-500';
  await scheduleRef.set({ year: 2027, month: 11, unitId: 'unit-1',
    publicationStatus: 'draft', publicationVersion: 0, operationalVersion: 0 });
  const entries = Array.from({ length: 500 }, (_, index) => ({ id: `shift-${index}`,
    value: { scheduleId: scheduleRef.id, userId: `person-${index % 20}`, unitId: 'unit-1',
      type: 'work', date: '2027-11-12', startTime: '09:00', endTime: '15:00',
      referenceRevisionId: `reference-${index}` } }));
  const people = Array.from({ length: 20 }, (_, index) => ({ userId: `person-${index}`,
    shifts: entries.filter((entry) => entry.value.userId === `person-${index}`)
      .map((entry) => ({ id: entry.id, ...entry.value })) }));
  const input = { scheduleRef, revisionId,
    identity: { draftGenerationId: 'draft-1', draftVersion: 500, operationalVersion: 0,
      publicationVersion: 0, baseRevisionId: null },
    entries, people, references: entries.map((entry, index) => ({ id: `reference-${index}`,
      value: { scheduleId: scheduleRef.id, shiftId: entry.id, event: 'created' } })),
    candidates: people.map((person) => ({ userId: person.userId, competence: '2027-11' })) };
  await assert.rejects(prepareScheduleRevision(input, async (index) => {
    if (index === 0) throw new Error('injected interruption');
  }), /injected interruption/);
  assert.equal((await scheduleRef.collection('revisions').doc(revisionId).get()).get('status'), 'preparing');
  const prepared = await prepareScheduleRevision(input);
  assert.equal(prepared.entryCount, 500);
  assert.equal((await scheduleRef.collection('revisions').doc(revisionId).get()).get('status'), 'ready');
  assert.equal((await scheduleRef.collection('revisions').doc(revisionId).collection('entries').get()).size, 500);
  assert.equal((await scheduleRef.collection('revisions').doc(revisionId).collection('people').get()).size, 20);
  assert.equal((await readOfficialScheduleShifts({ scheduleId: scheduleRef.id })).shifts.length, 0);
  await scheduleRef.update({ activeRevisionId: revisionId, publicationStatus: 'published', publicationVersion: 1 });
  assert.equal((await readOfficialScheduleShifts({ scheduleId: scheduleRef.id })).shifts.length, 500);
  assert.equal((await prepareScheduleRevision(input)).hash, prepared.hash);
  await assert.rejects(prepareScheduleRevision({ ...input, entries: entries.slice(1) }),
    { code: 'DP_REVISION_ID_COLLISION' });
});
