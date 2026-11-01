import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository', databaseId: 'coala' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { registerOverdueAutomaticAbsences } = await import('../../src/features/dp/time-adjustments/automatic-absence.server.ts');

test('ausência automática considera revisão oficial e ignora turno físico obsoleto', async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `auto-rev-${suffix}`;
  const uid = `${workspaceId}-user`;
  const unitId = `${workspaceId}-unit`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-schedule`);
  const revisionId = 'rev-1';
  const date = '2027-12-12';
  const shift = { id: 'official-work', scheduleId: schedule.id, unitId, userId: uid,
    date, type: 'work', startTime: '09:00', endTime: '17:00' };
  const automaticId = createHash('sha256').update(JSON.stringify([workspaceId, uid, date])).digest('hex');
  try {
    await Promise.all([
      schedule.set({ workspaceId, year: 2027, month: 12, unitId, locked: true,
        activeRevisionId: revisionId, publicationStatus: 'published', publicationVersion: 1,
        operationalVersion: 0, shiftCount: 1 }),
      schedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: schedule.id }),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(shift.id).set(shift),
      schedule.collection('shifts').doc('stale-work').set({ ...shift, id: 'stale-work', date: '2027-12-11' }),
      dbAdmin.collection('users').doc(uid).set({ username: 'Colaboradora', isActive: true }),
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade', timeZone: 'America/Belem' }),
    ]);
    const result = await registerOverdueAutomaticAbsences(workspaceId, { lookbackDays: 10 },
      { mainDb: dbAdmin, hrDb: dbAdmin, repDb: dbAdmin, now: () => new Date('2027-12-15T12:00:00Z') });
    assert.equal(result.checked, 1);
    assert.equal(result.created, 1);
    assert.equal((await dbAdmin.collection('ptrp_automaticAbsences').doc(automaticId).get()).get('shiftId'), shift.id);
  } finally {
    const audits = await dbAdmin.collection('ptrp_automaticAbsenceAudit').where('workspaceId', '==', workspaceId).get();
    await Promise.all([...audits.docs.map((doc) => doc.ref.delete()),
      dbAdmin.collection('ptrp_automaticAbsences').doc(automaticId).delete(),
      schedule.collection('shifts').doc('stale-work').delete(),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(shift.id).delete(),
      schedule.collection('revisions').doc(revisionId).delete(), schedule.delete(),
      dbAdmin.collection('users').doc(uid).delete(), dbAdmin.collection('dp_units').doc(unitId).delete()]);
  }
});
