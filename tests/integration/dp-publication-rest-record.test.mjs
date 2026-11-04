import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository', databaseId: 'coala' });

const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { stageWorkShift, publishSchedule } = await import('../../src/features/dp/schedules/publication-service.server.ts');

test('publicação congela datas e total do mês sem transferir repouso para a competência seguinte', async (t) => {
  const prefix = 'publication-rest-record';
  const workspaceId = `${prefix}-workspace`;
  const unitId = `${prefix}-unit`;
  const userId = `${prefix}-person`;
  const journeyId = `${prefix}-journey`;
  const current = dbAdmin.collection('dp_schedules').doc(`${prefix}-november`);
  const previous = dbAdmin.collection('dp_schedules').doc(`${prefix}-october`);
  const unit = dbAdmin.collection('dp_units').doc(unitId);
  const user = dbAdmin.collection('users').doc(userId);
  const journey = dbAdmin.collection('dp_journeys').doc(journeyId);
  const context = { decoded: { uid: `${prefix}-admin` }, userDoc: { username: 'DP Admin' },
    isDefaultAdmin: true, permissions: { dp: { schedules: { view: true, edit: true, publish: true } } }, workspace_id: workspaceId };

  await Promise.all([dbAdmin.recursiveDelete(current), dbAdmin.recursiveDelete(previous)]);
  t.after(async () => {
    await Promise.all([dbAdmin.recursiveDelete(current), dbAdmin.recursiveDelete(previous), unit.delete(), user.delete(), journey.delete()]);
  });
  await Promise.all([
    unit.set({ name: 'Unit', isArchived: false }),
    user.set({ username: 'Person', isActive: true, unitId, unitIds: [unitId] }),
    journey.set({ lineageId: journeyId, version: 1, status: 'published', name: 'Jornada coletiva',
      validFrom: '2026-01-01', weeklyMinutes: 2400, cycleLengthDays: 7,
      days: Array.from({ length: 7 }, (_, index) => ({ dayIndex: index + 1, plannedMinutes: index < 5 ? 480 : 0, isRestDay: index >= 5 })),
      regime: { mode: 'fixed' }, weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: 6, distribution: 'monthly_collective' },
      scaleValidation: { mode: 'consecutive_days' }, applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
    previous.set({ workspaceId, unitId, year: 2026, month: 10, publicationStatus: 'published', publicationVersion: 1,
      shiftCount: 1, createdAt: new Date() }),
    current.set({ workspaceId, unitId, year: 2026, month: 11, publicationStatus: 'published', publicationVersion: 1,
      operationalVersion: 0, draftVersion: 0, journeyValidationVersion: 0, shiftCount: 11, createdAt: new Date() }),
  ]);
  const dates = ['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10', '2026-11-13',
    '2026-11-16', '2026-11-19', '2026-11-22', '2026-11-25', '2026-11-28'];
  const batch = dbAdmin.batch();
  batch.set(previous.collection('shifts').doc('previous-rest'), { scheduleId: previous.id, userId, unitId,
    type: 'day_off', date: '2026-10-29' });
  dates.forEach((date, index) => batch.set(current.collection('shifts').doc(`rest-${index}`), {
    scheduleId: current.id, userId, unitId, type: 'day_off', date,
  }));
  batch.set(current.collection('shifts').doc('work'), { scheduleId: current.id, userId, unitId,
    type: 'work', date: '2026-11-02', startTime: '08:00', endTime: '16:00' });
  await batch.commit();

  await stageWorkShift({ context, scheduleId: current.id, shiftId: 'work', requestId: 'edit', mode: 'update',
    input: { userId, unitId, date: '2026-11-02', startTime: '08:00', endTime: '17:00' } });
  const result = await publishSchedule(context, current.id, 'publish-rest-record', 1);
  assert.equal(result.publicationVersion, 2);
  const after = await current.get();
  const stored = after.get('journeyValidation.restRecord');
  assert.equal(stored.competence, '2026-11');
  assert.equal(stored.publicationVersion, 2);
  assert.equal(stored.people[userId].monthRequired, 9);
  assert.equal(stored.people[userId].monthGranted, 10);
  assert.equal('journeyId' in stored.people[userId], false);
  assert.deepEqual(stored.people[userId].monthRestDates, dates);
  assert.equal(stored.people[userId].nextRestDueDate, '2026-12-05');
  const revision = await current.collection('revisions').doc(after.get('activeRevisionId')).get();
  assert.deepEqual(revision.get('restRecord'), stored);
});
