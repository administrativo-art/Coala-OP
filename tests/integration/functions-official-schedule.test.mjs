import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository', databaseId: 'coala' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { applyUserTerminationEffects } = await import('../../functions/src/user-termination-effects.ts');
const { readOfficialScheduleShifts } = await import('../../functions/src/official-schedule.ts');
const { occupancyClockId, ABSENCE_OPERATIONAL_COVERAGE_HASH } = await import('../../functions/src/absence-occupancy-clock.ts');

test('desligamento remove turnos futuros da revisão e do legado com relógios e índice coerentes', async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `termination-rev-${suffix}`;
  const userId = `${workspaceId}-user`;
  const unitId = `${workspaceId}-unit`;
  const revisionId = 'rev-1';
  const effectiveDate = '2027-12-10';
  const schedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-schedule`);
  const legacy = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-legacy`);
  const shifts = [{ id: 'past', date: '2027-12-09' },
    ...Array.from({ length: 21 }, (_, index) => ({ id: `future-${index + 1}`,
      date: `2027-12-${String(index + 11).padStart(2, '0')}` }))]
    .map((shift) => ({ ...shift, scheduleId: schedule.id, unitId, userId, type: 'work',
    startTime: '09:00', endTime: '17:00' }));
  const legacyShift = { scheduleId: legacy.id, unitId, userId, date: '2027-12-13',
    type: 'work', startTime: '09:00', endTime: '17:00' };
  const epoch = randomUUID();
  const index = dbAdmin.collection('dp_personScheduleIndex').doc(createHash('sha256')
    .update(`${userId}:2027-12`).digest('hex'));
  const readiness = dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId);
  try {
    await Promise.all([
      schedule.set({ workspaceId, year: 2027, month: 12, unitId, activeRevisionId: revisionId,
        publicationStatus: 'published', publicationVersion: 1, operationalVersion: 0,
        shiftCount: shifts.length, goalEligibilityVersion: 0, journeyValidationVersion: 0 }),
      schedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: schedule.id, shiftCount: shifts.length }),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(userId).set({ shifts }),
      ...shifts.map((shift) => schedule.collection('revisions').doc(revisionId).collection('entries').doc(shift.id).set(shift)),
      schedule.collection('shifts').doc('future-1').set(shifts[1]),
      legacy.set({ workspaceId, year: 2027, month: 12, unitId, shiftCount: 1 }),
      legacy.collection('shifts').doc('legacy-work').set(legacyShift),
      index.set({ userId, competence: '2027-12', scheduleIds: [schedule.id] }),
      readiness.set({ workspaceId, state: 'ready', bootstrapComplete: true,
        coverageHash: ABSENCE_OPERATIONAL_COVERAGE_HASH, scopeKind: 'workspace_all',
        scopeHash: 'a'.repeat(64), epoch }),
    ]);
    assert.deepEqual((await readOfficialScheduleShifts(dbAdmin, await schedule.get(),
      { date: '2027-12-11', userIds: [userId] })).map((shift) => shift.id), ['future-1']);
    const report = await applyUserTerminationEffects({ db: dbAdmin, hrDb: dbAdmin, checklistDb: dbAdmin,
      userId, user: { username: 'Colaboradora', terminationDate: effectiveDate },
      workspaceId, now: new Date('2027-12-14T12:00:00Z') });
    assert.equal(report.counts.futureShiftsRemoved, 22);
    assert.deepEqual((await readOfficialScheduleShifts(dbAdmin, await schedule.get(), { userIds: [userId] }))
      .map((shift) => shift.id), ['past']);
    assert.deepEqual((await readOfficialScheduleShifts(dbAdmin, await schedule.get())).map((shift) => shift.id), ['past']);
    assert.equal((await schedule.collection('shifts').doc('future-1').get()).exists, true);
    assert.equal((await schedule.get()).get('shiftCount'), 1);
    assert.equal((await schedule.get()).get('operationalVersion'), 2);
    assert.equal((await index.get()).get('scheduleIds').includes(schedule.id), true);
    assert.equal((await legacy.collection('shifts').doc('legacy-work').get()).exists, false);
    for (const date of ['2027-12-11', '2027-12-13', '2027-12-31']) {
      const clock = await dbAdmin.collection('dp_absenceOccupancyClocks').doc(occupancyClockId(workspaceId, userId, date)).get();
      assert.equal(clock.get('version'), date === '2027-12-13' ? 2 : 1);
    }
  } finally {
    await Promise.all([
      ...shifts.map((shift) => schedule.collection('revisions').doc(revisionId).collection('entries').doc(shift.id).delete()),
      ...shifts.map((shift) => schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc(shift.id).delete()),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(userId).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('people').doc(userId).delete(),
      schedule.collection('revisions').doc(revisionId).delete(), schedule.collection('shifts').doc('future-1').delete(),
      legacy.collection('shifts').doc('legacy-work').delete(), legacy.delete(), schedule.delete(), index.delete(), readiness.delete(),
      ...shifts.filter((shift) => shift.date > effectiveDate).map((shift) => dbAdmin.collection('dp_absenceOccupancyClocks')
        .doc(occupancyClockId(workspaceId, userId, shift.date)).delete()),
      dbAdmin.collection('terminationImpactReports').doc(`${userId}__${effectiveDate}`).delete(),
    ]);
  }
});
