import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const PROJECT_ID = 'demo-coala-repository';
const DATABASE_ID = 'coala';

assertFirestoreEmulatorSafety({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
process.env.BIZNEO_TOKEN = 'integration-test-token';

const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { publishDayOff } = await import('../../src/features/dp/day-offs/service.server.ts');

const scheduleId = 'integration-day-off-schedule';
const unitId = 'integration-day-off-unit';
const userId = 'integration-day-off-user';
const actorId = 'integration-day-off-admin';

const context = {
  decoded: { uid: actorId },
  userDoc: { id: actorId, username: 'Admin de integração' },
  profileId: null,
  permissions: structuredClone(defaultAdminPermissions),
  isDefaultAdmin: true,
  workspace_id: 'coala-one',
};

async function clearCollection(reference) {
  const snapshot = await reference.get();
  if (snapshot.empty) return;
  const batch = dbAdmin.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
}

async function cleanup() {
  await clearCollection(dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts'));
  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(scheduleId).delete(),
    dbAdmin.collection('dp_units').doc(unitId).delete(),
    dbAdmin.collection('users').doc(userId).delete(),
    clearCollection(dbAdmin.collection('dp_bizneo_day_off_operations')),
  ]);
  const auditSnapshot = await dbAdmin.collection('actionLogs').where('module', '==', 'dp.schedules').get();
  if (!auditSnapshot.empty) {
    const batch = dbAdmin.batch();
    auditSnapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

test('confirma, publica e torna a folga idempotente', async (t) => {
  await cleanup();
  t.after(cleanup);

  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(scheduleId).set({
      name: 'Setembro de 2026',
      year: 2026,
      month: 9,
      unitId,
      shiftCount: 7,
      locked: false,
      createdAt: new Date(),
    }),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque de integração', createdAt: new Date() }),
    dbAdmin.collection('users').doc(userId).set({
      username: 'Colaboradora de integração',
      registrationIdBizneo: '17044767',
      isActive: true,
    }),
  ]);

  const shiftBatch = dbAdmin.batch();
  for (let day = 1; day <= 6; day += 1) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    shiftBatch.set(dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts').doc(`work-${day}`), {
      scheduleId,
      unitId,
      userId,
      date,
      startTime: '10:00',
      endTime: '16:15',
      type: 'work',
      createdAt: new Date(),
    });
  }
  shiftBatch.set(dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts').doc('work-conflict'), {
    scheduleId,
    unitId,
    userId,
    date: '2026-09-08',
    startTime: '10:00',
    endTime: '16:15',
    type: 'work',
    createdAt: new Date(),
  });
  await shiftBatch.commit();

  const originalFetch = globalThis.fetch;
  const externalKinds = new Map([
    ['2026-09-07', 'schedule'],
    ['2026-09-09', 'one_time_rest'],
  ]);
  let postCount = 0;
  let transientFailureDate = '2026-09-10';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const date = body.one_time_schedule?.date;
      assert.deepEqual(body.one_time_schedule?.time_ranges, []);
      assert.equal(body.one_time_schedule?.state, 'published');
      if (date === transientFailureDate) {
        transientFailureDate = '';
        return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      externalKinds.set(date, 'one_time_rest');
      postCount += 1;
      return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } });
    }

    const date = url.searchParams.get('start_at');
    const kind = externalKinds.get(date) ?? 'schedule';
    return new Response(JSON.stringify({
      day_details: [{ date, kind, absences: [], time_ranges: kind === 'one_time_rest' ? [] : [{ start_at: '10:00:00', end_at: '16:15:00' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const permissionsWithoutPublication = structuredClone(defaultGuestPermissions);
  permissionsWithoutPublication.dp.schedules.view = true;
  permissionsWithoutPublication.dp.schedules.edit = true;
  await assert.rejects(
    () => publishDayOff({
      context: {
        ...context,
        isDefaultAdmin: false,
        userDoc: { ...context.userDoc, unitIds: [unitId] },
        permissions: permissionsWithoutPublication,
      },
      scheduleId,
      input: { userId, unitId, date: '2026-09-07', source: 'predicted' },
      requestId: 'request-forbidden',
    }),
    (error) => error?.code === 'DP_DAY_OFF_PUBLISH_FORBIDDEN',
  );

  const first = await publishDayOff({
    context,
    scheduleId,
    input: { userId, unitId, date: '2026-09-07', source: 'predicted' },
    requestId: 'request-first',
  });
  assert.equal(first.alreadyPublished, false);
  assert.equal(first.dayOff.bizneoSyncStatus, 'published');
  assert.equal(postCount, 1);

  const second = await publishDayOff({
    context,
    scheduleId,
    input: { userId, unitId, date: '2026-09-07', source: 'retry' },
    requestId: 'request-second',
  });
  assert.equal(second.alreadyPublished, true);
  assert.equal(postCount, 1);

  const manual = await publishDayOff({
    context,
    scheduleId,
    input: { userId, unitId, date: '2026-09-09', source: 'manual' },
    requestId: 'request-manual',
  });
  assert.equal(manual.dayOff.source, 'manual');
  assert.equal(postCount, 1, 'folga já existente no Bizneo não deve ser publicada novamente');

  await assert.rejects(
    () => publishDayOff({
      context,
      scheduleId,
      input: { userId, unitId, date: '2026-09-10', source: 'manual' },
      requestId: 'request-transient-failure',
    }),
    (error) => error?.code === 'BIZNEO_DAY_OFF_TEMPORARILY_UNAVAILABLE',
  );
  const failedDayOff = await dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts')
    .where('userId', '==', userId)
    .where('date', '==', '2026-09-10')
    .limit(2)
    .get();
  assert.equal(failedDayOff.size, 1);
  assert.equal(failedDayOff.docs[0].get('bizneoSyncStatus'), 'failed');

  const retried = await publishDayOff({
    context,
    scheduleId,
    input: { userId, unitId, date: '2026-09-10', source: 'retry' },
    requestId: 'request-after-transient-failure',
  });
  assert.equal(retried.dayOff.bizneoSyncStatus, 'published');
  assert.equal(postCount, 2);

  await assert.rejects(
    () => publishDayOff({
      context,
      scheduleId,
      input: { userId, unitId, date: '2026-09-08', source: 'manual' },
      requestId: 'request-conflict',
    }),
    (error) => error?.code === 'DP_DAY_OFF_WORK_SHIFT_CONFLICT',
  );

  const shifts = await dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts').get();
  const dayOffs = shifts.docs.filter((document) => document.get('type') === 'day_off');
  assert.equal(dayOffs.length, 3);
  assert.ok(dayOffs.every((document) => document.get('bizneoSyncStatus') === 'published'));

  const operations = await dbAdmin.collection('dp_bizneo_day_off_operations').get();
  assert.equal(operations.size, 3);
  assert.ok(operations.docs.every((document) => document.get('status') === 'published'));
});
