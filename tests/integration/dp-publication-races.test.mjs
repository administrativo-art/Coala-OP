import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { stageWorkShift, publishPreparedSchedule, listEditableScheduleShifts, discardConflictingDraftShifts } =
  await import('../../src/features/dp/schedules/publication-service.server.ts');
const { applyActiveRevisionOperationalChanges } =
  await import('../../src/features/dp/schedules/operational-overlay.server.ts');
const { saveClosedScheduleDay } = await import('../../src/features/dp/coverage-demands/service.server.ts');
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
  const beforeManual = (await schedule.get()).get('activeRevisionId');
  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'b', mode: 'update',
    requestId: 'manual-draft', input: { ...input, date: '2027-11-05',
      manualDay: { mode: 'flexible', expectedWorkMinutes: 360, expectedBreakMinutes: 0 } } });
  await assert.rejects(publishPreparedSchedule(context, schedule.id, 'manual-publish-blocked', 1),
    { code: 'DP_SCHEDULE_MANUAL_DAY_PUBLICATION_UNAVAILABLE' });
  const afterManual = await schedule.get();
  assert.equal(afterManual.get('activeRevisionId'), beforeManual);
  assert.equal(afterManual.get('publicationVersion'), 3);
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.find((shift) => shift.id === 'b').manualDay, undefined);
  const draftWithManual = await listEditableScheduleShifts(context, schedule.id);
  assert.deepEqual(draftWithManual.conflicts, []);
  assert.equal(draftWithManual.shifts.find((shift) => shift.id === 'b').manualDay.mode, 'flexible');

  await stageWorkShift({ context, scheduleId: schedule.id, shiftId: 'b', mode: 'update',
    requestId: 'remove-manual-draft', input: { ...input, date: '2027-11-05' } });
  const plain = await publishPreparedSchedule(context, schedule.id, 'publish-ordinary-again', 2);
  assert.equal(plain.publicationVersion, 4);

  const changeClosure = (date, closed) => saveClosedScheduleDay({
    context, scheduleId: schedule.id, date, requestId: 'closure',
    input: { closed, schedules: [{ scheduleId: schedule.id, unitId }] },
  });
  await changeClosure('2027-11-05', true);
  await assert.rejects(publishPreparedSchedule(context, schedule.id, 'closure-with-shift', 1),
    { code: 'DP_SCHEDULE_CLOSED_DAY_HAS_WORK' });
  assert.equal((await schedule.get()).get('closedDates'), undefined);
  await changeClosure('2027-11-05', false);
  await changeClosure('2027-11-06', true);
  const closed = await publishPreparedSchedule(context, schedule.id, 'closure-without-shift', 3);
  assert.equal(closed.publicationVersion, 5);
  const afterClosure = await schedule.get();
  assert.deepEqual(afterClosure.get('closedDates'), ['2027-11-06']);
  assert.equal(afterClosure.get('draftClosedDates'), undefined);
  const activeB = (await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts.find((shift) => shift.id === 'b');
  await assert.rejects(dbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(schedule);
    await applyActiveRevisionOperationalChanges({ tx, schedule: snapshot, workspaceId,
      changes: [{ shiftId: 'b', previous: activeB, next: { ...activeB, date: '2027-11-06' } }],
      actorId: personId, reason: 'shift_swap_accepted' });
  }), { code: 'DP_OPERATIONAL_DAY_CLOSED' });

});

test('publica os trechos híbridos juntos e preserva todos os ponteiros se um rascunho mudar', async () => {
  const { stageManualJourneyDraft } = await import('../../src/features/dp/schedules/publication-service.server.ts');
  const { readRepPMonthOfPerson } = await import('../../src/features/dp/rep-p/own-month.server.ts');
  const prefix = 'publication-hybrid';
  const workspaceId = `${prefix}-workspace`;
  const userId = `${prefix}-person`;
  const unitIds = [`${prefix}-x`, `${prefix}-y`];
  const schedules = unitIds.map((id) => dbAdmin.collection('dp_schedules').doc(id));
  const context = { decoded: { uid: `${prefix}-admin` }, userDoc: { username: 'Admin' },
    isDefaultAdmin: true, permissions: { dp: { schedules: { view: true, edit: true, publish: true } } }, workspace_id: workspaceId };
  const date = '2027-12-08';
  await Promise.all([
    ...schedules.map((schedule, index) => schedule.set({ workspaceId, unitId: unitIds[index], year: 2027, month: 12,
      publicationStatus: 'draft', publicationVersion: 0, operationalVersion: 0, draftVersion: 0, journeyValidationVersion: 0 })),
    ...unitIds.map((id) => dbAdmin.collection('dp_units').doc(id).set({ name: id, isArchived: false })),
    dbAdmin.collection('users').doc(userId).set({ username: 'Person', unitId: unitIds[0], unitIds, isActive: true }),
    dbAdmin.collection('dp_journeys').doc(prefix).set({ lineageId: prefix, version: 1, status: 'published', name: 'Hybrid',
      validFrom: '2027-12-01', weeklyMinutes: 2400, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 480, isRestDay: false }],
      applicability: { scope: { kind: 'company' }, collaboratorIds: [userId] }, allowedShiftDefinitionIds: [] }),
  ]);
  const version = { expectedDraftVersion: 0, expectedDraftGenerationId: 'initial', expectedOperationalVersion: 0 };
  await stageManualJourneyDraft(context, { userId, date, segments: [
    { ...version, scheduleId: schedules[0].id, shiftId: 'x', existing: false, unitId: unitIds[0],
      startTime: '', endTime: '', manualDay: { mode: 'flexible', expectedWorkMinutes: 240, expectedBreakMinutes: 0 } },
    { ...version, scheduleId: schedules[1].id, shiftId: 'y', existing: false, unitId: unitIds[1],
      startTime: '13:00', endTime: '17:00', manualDay: { mode: 'fixed', expectedBreakMinutes: 0 } },
  ] }, 'stage-hybrid');

  assert.deepEqual((await listEditableScheduleShifts(context, schedules[0].id)).linkedScheduleIds, schedules.map(({ id }) => id));
  await assert.rejects(publishPreparedSchedule(context, schedules[0].id, 'incomplete', 1),
    { code: 'DP_SCHEDULE_PUBLICATION_GROUP_REQUIRED' });
  const companion = { scheduleId: schedules[1].id, expectedDraftVersion: 1 };
  await assert.rejects(publishPreparedSchedule(context, schedules[0].id, 'stale', 1, async () => {
    await schedules[1].update({ draftVersion: 2 });
  }, [companion]), { code: 'DP_SCHEDULE_PUBLICATION_STALE' });
  for (const schedule of schedules) assert.equal((await schedule.get()).get('activeRevisionId'), undefined);

  const published = await publishPreparedSchedule(context, schedules[0].id, 'publish-hybrid', 1, undefined,
    [{ ...companion, expectedDraftVersion: 2 }]);
  assert.deepEqual(published.publishedScheduleIds, schedules.map(({ id }) => id));
  const official = await readRepPMonthOfPerson([userId], '2027-12');
  assert.deepEqual(official.shifts.sort((a, b) => a.manualOrder - b.manualOrder).map((shift) =>
    [shift.unitId, shift.manualMode, shift.manualWorkMinutes ?? null, shift.startTime, shift.endTime]), [
    [unitIds[0], 'flexible', 240, null, null],
    [unitIds[1], 'fixed', null, '13:00', '17:00'],
  ]);
  const { buildCollaboratorSchedulePayload } = await import('../../src/features/collaborator-schedule/server.ts');
  const portal = await buildCollaboratorSchedulePayload({
    ...context, decoded: { uid: userId }, userDoc: { id: userId, unitIds }, isDefaultAdmin: false,
  }, 2027, 12);
  assert.deepEqual(portal.shifts.sort((a, b) => a.manualOrder - b.manualOrder).map((shift) =>
    [shift.unitId, shift.manualDay?.mode, shift.manualDay?.expectedWorkMinutes ?? null]), [
    [unitIds[0], 'flexible', 240], [unitIds[1], 'fixed', null],
  ]);
});
