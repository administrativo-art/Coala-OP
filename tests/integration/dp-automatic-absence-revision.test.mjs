import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository', databaseId: 'coala' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { registerOverdueAutomaticAbsences, reconcileAutomaticAbsenceForDay } = await import('../../src/features/dp/time-adjustments/automatic-absence.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

test('ausência automática considera revisão oficial e ignora turno físico obsoleto', async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `auto-rev-${suffix}`;
  const uid = `${workspaceId}-user`;
  const unitId = `${workspaceId}-unit`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-schedule`);
  const conflictSchedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-conflict`);
  const revisionId = 'rev-1';
  const date = '2027-12-12';
  const shift = { id: 'official-work', scheduleId: schedule.id, unitId, userId: uid,
    date, type: 'work', startTime: '09:00', endTime: '17:00' };
  const secondShift = { ...shift, id: 'official-work-later', startTime: '17:00', endTime: '20:00' };
  const automaticId = createHash('sha256').update(JSON.stringify([workspaceId, uid, date])).digest('hex');
  try {
    await Promise.all([
      schedule.set({ workspaceId, year: 2027, month: 12, unitId, locked: true,
        activeRevisionId: revisionId, publicationStatus: 'published', publicationVersion: 1,
        operationalVersion: 0, shiftCount: 2 }),
      schedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: schedule.id }),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(shift.id).set(shift),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(secondShift.id).set(secondShift),
      schedule.collection('shifts').doc('stale-work').set({ ...shift, id: 'stale-work', date: '2027-12-11' }),
      dbAdmin.collection('users').doc(uid).set({ username: 'Colaboradora', isActive: true }),
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade', timeZone: 'America/Belem' }),
    ]);
    const result = await registerOverdueAutomaticAbsences(workspaceId, { lookbackDays: 10 },
      { mainDb: dbAdmin, hrDb: dbAdmin, repDb: dbAdmin, now: () => new Date('2027-12-15T12:00:00Z') });
    assert.equal(result.checked, 2);
    assert.equal(result.created, 1);
    assert.equal((await dbAdmin.collection('ptrp_automaticAbsences').doc(automaticId).get()).get('shiftId'), shift.id);
    assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id, db: dbAdmin })).shifts.length, 0);
    assert.equal((await schedule.get()).get('goalEligibilityVersion'), 2);
    await registerOverdueAutomaticAbsences(workspaceId, { lookbackDays: 10 },
      { mainDb: dbAdmin, hrDb: dbAdmin, repDb: dbAdmin, now: () => new Date('2027-12-15T12:00:00Z') });
    assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id, db: dbAdmin })).shifts.length, 0);
    await dbAdmin.collection('ptrp_adjustmentRequests').doc(`${workspaceId}-correction`).set({
      workspaceId, employeeUid: uid, workDate: date, status: 'approved', kind: 'include',
      inclusion: { markedAt: '2027-12-12T09:00:00-0300' },
    });
    await conflictSchedule.set({ workspaceId, year: 2027, month: 12, unitId, publicationStatus: 'published', shiftCount: 1 });
    await conflictSchedule.collection('shifts').doc('replacement').set({ id: 'replacement', scheduleId: conflictSchedule.id,
      unitId, userId: uid, date, type: 'work', startTime: '09:00', endTime: '17:00' });
    await assert.rejects(reconcileAutomaticAbsenceForDay(workspaceId, uid, date,
      { mainDb: dbAdmin, hrDb: dbAdmin, repDb: dbAdmin }), (error) => error.code === 'AUTOMATIC_ABSENCE_RESTORE_REVIEW_REQUIRED');
    assert.equal((await dbAdmin.collection('ptrp_automaticAbsences').doc(automaticId).get()).get('scheduleSyncStatus'), 'review_required');
    assert.equal((await dbAdmin.collection('dp_responsibilityTasks').doc(`${automaticId}_automatic_absence_review`).get()).exists, true);
    await conflictSchedule.collection('shifts').doc('replacement').delete();
    await reconcileAutomaticAbsenceForDay(workspaceId, uid, date, { mainDb: dbAdmin, hrDb: dbAdmin, repDb: dbAdmin });
    assert.equal((await readOfficialScheduleShifts({ scheduleId: schedule.id, db: dbAdmin })).shifts.length, 2);
    assert.equal((await schedule.get()).get('goalEligibilityVersion'), 4);
    assert.equal((await dbAdmin.collection('ptrp_automaticAbsences').doc(automaticId).get()).get('scheduleSyncStatus'), 'restored');
    assert.equal((await dbAdmin.collection('dp_responsibilityTasks').doc(`${automaticId}_automatic_absence_review`).get()).get('status'), 'resolved');
  } finally {
    const audits = await dbAdmin.collection('ptrp_automaticAbsenceAudit').where('workspaceId', '==', workspaceId).get();
    await Promise.all([...audits.docs.map((doc) => doc.ref.delete()),
      dbAdmin.collection('ptrp_automaticAbsences').doc(automaticId).delete(),
      dbAdmin.collection('ptrp_adjustmentRequests').doc(`${workspaceId}-correction`).delete(),
      dbAdmin.collection('dp_responsibilityTasks').doc(`${automaticId}_automatic_absence_review`).delete(),
      conflictSchedule.collection('shifts').doc('replacement').delete(), conflictSchedule.delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc(shift.id).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc(secondShift.id).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('people').doc(uid).delete(),
      schedule.collection('shifts').doc('stale-work').delete(),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(shift.id).delete(),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(secondShift.id).delete(),
      schedule.collection('revisions').doc(revisionId).delete(), schedule.delete(),
      dbAdmin.collection('users').doc(uid).delete(), dbAdmin.collection('dp_units').doc(unitId).delete()]);
  }
});
