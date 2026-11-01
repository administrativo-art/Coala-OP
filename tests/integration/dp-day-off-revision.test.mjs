import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository', databaseId: 'coala' });
process.env.BIZNEO_TOKEN = 'integration-test-token';
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { publishDayOff, removeDayOff } = await import('../../src/features/dp/day-offs/service.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

test('folga Bizneo em revisão ativa publica, falha, repete e remove por overlay', async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `dayoff-rev-${suffix}`;
  const userId = `${workspaceId}-user`;
  const unitId = `${workspaceId}-unit`;
  const date = '2027-12-12';
  const schedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-schedule`);
  const revisionId = 'rev-1';
  const officialWork = { id: 'official-work', scheduleId: schedule.id, unitId, userId,
    date: '2027-12-13', type: 'work', startTime: '09:00', endTime: '17:00' };
  const context = { decoded: { uid: `${workspaceId}-admin` }, userDoc: { username: 'Admin' },
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const originalFetch = globalThis.fetch;
  let kind = 'schedule';
  let failPost = true;
  let failDelete = true;
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      if (failPost) { failPost = false; return new Response('{}', { status: 503 }); }
      kind = 'one_time_rest';
      return new Response('{}', { status: 201 });
    }
    if (method === 'DELETE') {
      if (failDelete) { failDelete = false; return new Response('{}', { status: 503 }); }
      kind = 'schedule';
      return new Response('{}', { status: 200 });
    }
    assert.equal(new URL(String(input)).searchParams.get('start_at'), date);
    return new Response(JSON.stringify({ day_details: [{ date, kind, absences: [], time_ranges: [] }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const official = () => readOfficialScheduleShifts({ scheduleId: schedule.id, userId });
  try {
    await Promise.all([
      schedule.set({ workspaceId, year: 2027, month: 12, unitId, locked: false, shiftCount: 1,
        activeRevisionId: revisionId, publicationStatus: 'published', publicationVersion: 1,
        operationalVersion: 0, goalEligibilityVersion: 0, journeyValidationVersion: 0 }),
      schedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: schedule.id, shiftCount: 1 }),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(officialWork.id).set(officialWork),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(userId).set({ shifts: [officialWork] }),
      schedule.collection('shifts').doc('stale-work').set({ scheduleId: schedule.id, unitId, userId,
        date, type: 'work', startTime: '09:00', endTime: '17:00' }),
      dbAdmin.collection('dp_personScheduleIndex').doc(createHash('sha256').update(`${userId}:2027-12`).digest('hex'))
        .set({ userId, competence: '2027-12', scheduleIds: [schedule.id] }),
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade teste' }),
      dbAdmin.collection('users').doc(userId).set({ username: 'Colaboradora', isActive: true,
        registrationIdBizneo: '17044767', unitId }),
    ]);
    const input = { userId, unitId, date, source: 'manual' };
    await assert.rejects(publishDayOff({ context, scheduleId: schedule.id, input, requestId: 'first' }),
      { code: 'BIZNEO_DAY_OFF_TEMPORARILY_UNAVAILABLE' });
    let shifts = (await official()).shifts;
    assert.equal(shifts.length, 2);
    assert.equal(shifts.find((shift) => shift.type === 'day_off')?.bizneoSyncStatus, 'failed');
    const result = await publishDayOff({ context, scheduleId: schedule.id,
      input: { ...input, source: 'retry' }, requestId: 'retry' });
    assert.equal(result.dayOff.bizneoSyncStatus, 'published');
    shifts = (await official()).shifts;
    assert.equal(shifts.find((shift) => shift.type === 'day_off')?.bizneoSyncStatus, 'published');
    assert.equal((await schedule.collection('shifts').get()).size, 1);
    assert.equal((await schedule.get()).get('shiftCount'), 2);
    const removalInput = { userId, unitId, date, shiftId: shifts.find((shift) => shift.type === 'day_off').id };
    await assert.rejects(removeDayOff({ context, scheduleId: schedule.id, input: removalInput, requestId: 'remove-first' }),
      { code: 'BIZNEO_DAY_OFF_REMOVAL_TEMPORARILY_UNAVAILABLE' });
    assert.equal((await official()).shifts.find((shift) => shift.type === 'day_off')?.bizneoSyncStatus, 'removal_failed');
    const removed = await removeDayOff({ context, scheduleId: schedule.id, input: removalInput, requestId: 'remove-retry' });
    assert.equal(removed.removed, true);
    assert.equal((await official()).shifts.length, 1);
    assert.equal((await schedule.get()).get('shiftCount'), 1);
    await assert.rejects(publishDayOff({ context, scheduleId: schedule.id,
      input: { ...input, date: officialWork.date }, requestId: 'official-conflict' }),
      { code: 'DP_DAY_OFF_WORK_SHIFT_CONFLICT' });
  } finally {
    globalThis.fetch = originalFetch;
    const operationId = createHash('sha256').update(JSON.stringify([workspaceId, userId, date])).digest('hex').slice(0, 32);
    const shiftId = `day-off-${operationId.slice(0, 20)}`;
    const logs = await dbAdmin.collection('actionLogs').where('workspace_id', '==', workspaceId).get();
    await Promise.all(logs.docs.map((doc) => doc.ref.delete()));
    await Promise.all([
      dbAdmin.collection('dp_bizneo_day_off_operations').doc(operationId).delete(),
      dbAdmin.collection('dp_personScheduleIndex').doc(createHash('sha256').update(`${userId}:2027-12`).digest('hex')).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc(shiftId).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('people').doc(userId).delete(),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc(officialWork.id).delete(),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(userId).delete(),
      schedule.collection('shifts').doc('stale-work').delete(),
      schedule.collection('revisions').doc(revisionId).delete(), schedule.delete(),
      dbAdmin.collection('dp_units').doc(unitId).delete(), dbAdmin.collection('users').doc(userId).delete(),
    ]);
  }
});
