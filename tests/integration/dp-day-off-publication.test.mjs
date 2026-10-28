import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const PROJECT_ID = 'demo-coala-repository';
const DATABASE_ID = 'coala';

assertFirestoreEmulatorSafety({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
process.env.BIZNEO_TOKEN = 'integration-test-token';

const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { publishDayOff, removeDayOff } = await import('../../src/features/dp/day-offs/service.server.ts');
const { deleteDPSchedule } = await import('../../src/features/dp/schedules/delete-service.server.ts');
const { createEmployeeGoal } = await import('../../src/features/goals/employee-goals/service.server.ts');
const { transitionGoalPeriod } = await import('../../src/features/goals/period-status/service.server.ts');
const { saveWorkShift } = await import('../../src/features/dp/shifts/service.server.ts');
const { listExternalCoverageCandidates } = await import('../../src/features/dp/external-candidates/service.server.ts');
const {
  createShiftDefinition,
  createTimeConfig,
  deleteShiftDefinition,
  DP_TIME_COLLECTIONS,
  updateShiftDefinition,
  updateTimeConfig,
} = await import('../../src/features/dp/time-config/service.server.ts');

const scheduleId = 'integration-day-off-schedule';
const unitId = 'integration-day-off-unit';
const userId = 'integration-day-off-user';
const actorId = 'integration-day-off-admin';
const journeyId = 'integration-day-off-journey';

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

async function seedPublishedCompanyJourney(id, overrides = {}) {
  await dbAdmin.collection('dp_journeys').doc(id).set({
    lineageId: id,
    version: 1,
    status: 'published',
    name: 'Jornada padrão de integração',
    weeklyMinutes: 2_400,
    cycleLengthDays: 7,
    days: Array.from({ length: 7 }, (_, dayIndex) => ({
      dayIndex,
      plannedMinutes: dayIndex === 6 ? 0 : 400,
      isRestDay: dayIndex === 6,
    })),
    regime: { mode: 'fixed' },
    weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: 6 },
    scaleValidation: { mode: 'consecutive_days' },
    allowedShiftDefinitionIds: [],
    applicability: { scope: { kind: 'company' } },
    validFrom: '2026-01-01',
    createdAt: new Date(),
    createdBy: actorId,
    updatedAt: new Date(),
    updatedBy: actorId,
    publishedAt: new Date(),
    publishedBy: actorId,
    ...overrides,
  });
}

async function cleanup() {
  await clearCollection(dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts'));
  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(scheduleId).delete(),
    dbAdmin.collection('dp_units').doc(unitId).delete(),
    dbAdmin.collection('users').doc(userId).delete(),
    dbAdmin.collection('dp_journeys').doc(journeyId).delete(),
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
    seedPublishedCompanyJourney(journeyId),
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
  let deleteCount = 0;
  let transientFailureDate = '2026-09-10';
  let transientRemovalDate = '2026-09-09';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'DELETE') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const date = body.one_time_schedule?.date;
      assert.equal(typeof date, 'string');
      if (date === transientRemovalDate) {
        transientRemovalDate = '';
        return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      externalKinds.set(date, 'schedule');
      deleteCount += 1;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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

  const publishedDayOff = dayOffs.find((document) => document.get('date') === '2026-09-07');
  assert.ok(publishedDayOff);
  await assert.rejects(
    () => removeDayOff({
      context: {
        ...context,
        isDefaultAdmin: false,
        userDoc: { ...context.userDoc, unitIds: [unitId] },
        permissions: permissionsWithoutPublication,
      },
      scheduleId,
      input: {
        shiftId: publishedDayOff.id,
        userId,
        unitId,
        date: '2026-09-07',
      },
      requestId: 'request-remove-forbidden',
    }),
    (error) => error?.code === 'DP_DAY_OFF_PUBLISH_FORBIDDEN',
  );
  const removed = await removeDayOff({
    context,
    scheduleId,
    input: {
      shiftId: publishedDayOff.id,
      userId,
      unitId,
      date: '2026-09-07',
    },
    requestId: 'request-remove',
  });
  assert.equal(removed.alreadyRemoved, false);
  assert.equal(deleteCount, 1);
  assert.equal((await publishedDayOff.ref.get()).exists, false);

  const removedAgain = await removeDayOff({
    context,
    scheduleId,
    input: {
      shiftId: publishedDayOff.id,
      userId,
      unitId,
      date: '2026-09-07',
    },
    requestId: 'request-remove-again',
  });
  assert.equal(removedAgain.alreadyRemoved, true);
  assert.equal(deleteCount, 1);
  assert.equal((await dbAdmin.collection('dp_bizneo_day_off_operations').doc(
    publishedDayOff.get('bizneoOperationId'),
  ).get()).get('status'), 'removed');

  const manualDayOff = dayOffs.find((document) => document.get('date') === '2026-09-09');
  assert.ok(manualDayOff);
  await assert.rejects(
    () => removeDayOff({
      context,
      scheduleId,
      input: {
        shiftId: manualDayOff.id,
        userId,
        unitId,
        date: '2026-09-09',
      },
      requestId: 'request-remove-transient-failure',
    }),
    (error) => error?.code === 'BIZNEO_DAY_OFF_REMOVAL_TEMPORARILY_UNAVAILABLE',
  );
  const retainedAfterFailure = await manualDayOff.ref.get();
  assert.equal(retainedAfterFailure.exists, true);
  assert.equal(retainedAfterFailure.get('bizneoSyncStatus'), 'removal_failed');

  const removalRetried = await removeDayOff({
    context,
    scheduleId,
    input: {
      shiftId: manualDayOff.id,
      userId,
      unitId,
      date: '2026-09-09',
    },
    requestId: 'request-remove-after-transient-failure',
  });
  assert.equal(removalRetried.alreadyRemoved, false);
  assert.equal(deleteCount, 2);
  assert.equal((await manualDayOff.ref.get()).exists, false);
});

test('impede criar ou transferir turno para uma pessoa com folga', async (t) => {
  const workScheduleId = 'integration-work-shift-schedule';
  const workUnitId = 'integration-work-shift-unit';
  const workUserId = 'integration-work-shift-user';
  const dayOffUserId = 'integration-work-shift-user-with-day-off';
  const workJourneyId = 'integration-work-shift-journey';
  const date = '2026-09-06';
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(workScheduleId);
  const shiftsRef = scheduleRef.collection('shifts');

  async function cleanupWorkShiftFixture() {
    await clearCollection(shiftsRef);
    await Promise.all([
      scheduleRef.delete(),
      dbAdmin.collection('dp_units').doc(workUnitId).delete(),
      dbAdmin.collection('users').doc(workUserId).delete(),
      dbAdmin.collection('users').doc(dayOffUserId).delete(),
      dbAdmin.collection('dp_journeys').doc(workJourneyId).delete(),
    ]);
  }

  await cleanupWorkShiftFixture();
  t.after(cleanupWorkShiftFixture);

  await Promise.all([
    scheduleRef.set({
      name: 'Setembro de 2026',
      year: 2026,
      month: 9,
      unitId: workUnitId,
      shiftCount: 0,
      locked: false,
      createdAt: new Date(),
    }),
    dbAdmin.collection('dp_units').doc(workUnitId).set({ name: 'Quiosque de integração', createdAt: new Date() }),
    dbAdmin.collection('users').doc(workUserId).set({ username: 'Sem folga', isActive: true, unitId: workUnitId, unitIds: [workUnitId] }),
    dbAdmin.collection('users').doc(dayOffUserId).set({ username: 'Com folga', isActive: true, unitId: workUnitId, unitIds: [workUnitId] }),
    seedPublishedCompanyJourney(workJourneyId),
  ]);
  await shiftsRef.doc('published-day-off').set({
    scheduleId: workScheduleId,
    unitId: workUnitId,
    userId: dayOffUserId,
    date,
    startTime: '',
    endTime: '',
    type: 'day_off',
    bizneoSyncStatus: 'published',
    createdAt: new Date(),
  });

  const input = {
    userId: dayOffUserId,
    userName: 'Com folga',
    unitId: workUnitId,
    date,
    startTime: '08:45',
    endTime: '15:00',
    type: 'work',
  };
  await assert.rejects(
    () => saveWorkShift({
      context,
      scheduleId: workScheduleId,
      shiftId: 'work-1',
      input,
      mode: 'create',
      requestId: 'request-create-with-day-off',
    }),
    (error) => error?.code === 'DP_SHIFT_DAY_OFF_CONFLICT',
  );
  assert.equal((await shiftsRef.doc('work-1').get()).exists, false);

  const created = await saveWorkShift({
    context,
    scheduleId: workScheduleId,
    shiftId: 'work-1',
    input: { ...input, userId: workUserId, userName: 'Sem folga' },
    mode: 'create',
    requestId: 'request-create-without-day-off',
  });
  assert.equal(created.shiftId, 'work-1');
  assert.equal((await scheduleRef.get()).get('shiftCount'), 1);

  await assert.rejects(
    () => saveWorkShift({
      context,
      scheduleId: workScheduleId,
      shiftId: 'work-1',
      input,
      mode: 'update',
      requestId: 'request-transfer-to-day-off',
    }),
    (error) => error?.code === 'DP_SHIFT_DAY_OFF_CONFLICT',
  );
  assert.equal((await shiftsRef.doc('work-1').get()).get('userId'), workUserId);
});

test('aceita ocorrência que atravessa a meia-noite somente com turno noturno correspondente', async (t) => {
  const scheduleId = 'integration-overnight-schedule';
  const unitId = 'integration-overnight-unit';
  const userId = 'integration-overnight-user';
  const definitionId = 'integration-overnight-definition';
  const journeyId = 'integration-overnight-journey';
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);

  async function cleanupOvernightFixture() {
    await clearCollection(scheduleRef.collection('shifts'));
    await Promise.all([
      scheduleRef.delete(),
      dbAdmin.collection('dp_units').doc(unitId).delete(),
      dbAdmin.collection('users').doc(userId).delete(),
      dbAdmin.collection('dp_shiftDefinitions').doc(definitionId).delete(),
      dbAdmin.collection('dp_journeys').doc(journeyId).delete(),
    ]);
  }

  await cleanupOvernightFixture();
  t.after(cleanupOvernightFixture);
  await Promise.all([
    scheduleRef.set({ name: 'Setembro de 2026', year: 2026, month: 9, unitId, shiftCount: 0, locked: false, createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade noturna' }),
    dbAdmin.collection('users').doc(userId).set({ username: 'Pessoa noturna', isActive: true, unitId, unitIds: [unitId] }),
    dbAdmin.collection('dp_shiftDefinitions').doc(definitionId).set({
      code: 'N1', name: 'Noturno', startTime: '22:00', endTime: '06:00', overnight: true, daysOfWeek: [1, 2, 3, 4, 5],
    }),
    seedPublishedCompanyJourney(journeyId, { allowedShiftDefinitionIds: [definitionId] }),
  ]);

  await assert.rejects(
    () => saveWorkShift({
      context,
      scheduleId,
      shiftId: 'wrong-night',
      input: { userId, unitId, date: '2026-09-10', shiftDefinitionId: definitionId, startTime: '21:00', endTime: '06:00', type: 'work' },
      mode: 'create',
      requestId: 'request-wrong-overnight',
    }),
    (error) => error?.code === 'DP_SHIFT_OVERNIGHT_DEFINITION_REQUIRED',
  );

  await saveWorkShift({
    context,
    scheduleId,
    shiftId: 'valid-night',
    input: { userId, unitId, date: '2026-09-10', shiftDefinitionId: definitionId, startTime: '22:00', endTime: '06:00', type: 'work' },
    mode: 'create',
    requestId: 'request-valid-overnight',
  });
  assert.equal((await scheduleRef.collection('shifts').doc('valid-night').get()).get('overnight'), true);
});

test('deriva cobertura externa no servidor e exige permissão e motivo', async (t) => {
  const workScheduleId = 'integration-external-coverage-schedule';
  const executionUnitId = 'integration-external-coverage-unit';
  const originUnitId = 'integration-external-origin-unit';
  const secondOriginUnitId = 'integration-external-second-origin-unit';
  const financialUnitId = 'integration-external-financial-unit';
  const externalUserId = 'integration-external-coverage-user';
  const goalKioskId = 'integration-external-coverage-kiosk';
  const goalPeriodId = 'integration-external-coverage-period';
  const originKioskId = 'integration-external-origin-kiosk';
  const originGoalPeriodId = 'integration-external-origin-period';
  const journeyId = 'integration-external-coverage-journey';
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(workScheduleId);
  const shiftRef = scheduleRef.collection('shifts').doc('external-work');

  async function cleanupExternalCoverageFixture() {
    await clearCollection(scheduleRef.collection('shifts'));
    await Promise.all([
      scheduleRef.delete(),
      dbAdmin.collection('dp_units').doc(executionUnitId).delete(),
      dbAdmin.collection('dp_units').doc(originUnitId).delete(),
      dbAdmin.collection('dp_units').doc(secondOriginUnitId).delete(),
      dbAdmin.collection('dp_units').doc(financialUnitId).delete(),
      dbAdmin.collection('users').doc(externalUserId).delete(),
      dbAdmin.collection('kiosks').doc(goalKioskId).delete(),
      dbAdmin.collection('kiosks').doc(originKioskId).delete(),
      dbAdmin.collection('goalPeriods').doc(goalPeriodId).delete(),
      dbAdmin.collection('goalPeriods').doc(originGoalPeriodId).delete(),
      dbAdmin.collection('dp_journeys').doc(journeyId).delete(),
    ]);
    const employeeGoals = await dbAdmin.collection('employeeGoals').where('periodId', '==', goalPeriodId).get();
    const originEmployeeGoals = await dbAdmin.collection('employeeGoals').where('periodId', '==', originGoalPeriodId).get();
    if (!employeeGoals.empty || !originEmployeeGoals.empty) {
      const batch = dbAdmin.batch();
      employeeGoals.docs.forEach((document) => batch.delete(document.ref));
      originEmployeeGoals.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }

  await cleanupExternalCoverageFixture();
  t.after(cleanupExternalCoverageFixture);
  await Promise.all([
    scheduleRef.set({ name: 'Setembro de 2026', year: 2026, month: 9, unitId: executionUnitId, shiftCount: 0, locked: false, createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(executionUnitId).set({ name: 'Unidade de execução', createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(originUnitId).set({ name: 'Unidade de origem', createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(secondOriginUnitId).set({ name: 'Segunda unidade operacional', createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(financialUnitId).set({ name: 'Unidade financeira', createdAt: new Date() }),
    dbAdmin.collection('users').doc(externalUserId).set({ username: 'Cobertura externa', isActive: true,
      unitId: financialUnitId, unitIds: [originUnitId, secondOriginUnitId] }),
    dbAdmin.collection('kiosks').doc(goalKioskId).set({ name: 'Unidade de execução' }),
    dbAdmin.collection('kiosks').doc(originKioskId).set({ name: 'Unidade de origem' }),
    dbAdmin.collection('goalPeriods').doc(goalPeriodId).set({
      kioskId: goalKioskId,
      status: 'active',
      startDate: new Date('2026-09-01T03:00:00.000Z'),
      endDate: new Date('2026-09-30T03:00:00.000Z'),
      targetValue: 1000,
      upValue: 1200,
      currentValue: 1500,
      distributionMode: 'calendar_days',
      shifts: [{ id: 'morning', label: 'Manhã (08:00–16:00)', fraction: 1 }],
      goalMethodSnapshot: {
        id: 'integration-tiered', name: 'Faixas', type: 'tiered_unit_bonus', active: true,
        targetPeriod: 'monthly', referenceRevenue: 0,
        tiers: [{ id: 'target', label: 'Meta', fromAmount: 1000, toAmount: null, fixedBonusAmount: 100, excessPercent: 0 }],
        teamBonus: { enabled: true, splitMode: 'equal', eligibleCollaboratorRule: 'all_goal_participants', prorateByAttendance: false },
        leadershipBonus: { enabled: false, factorNumerator: 0, factorDenominator: 1 },
        incentiveMessages: [],
      },
    }),
    dbAdmin.collection('goalPeriods').doc(originGoalPeriodId).set({
      kioskId: originKioskId,
      status: 'active',
      startDate: new Date('2026-09-01T03:00:00.000Z'),
      endDate: new Date('2026-09-30T03:00:00.000Z'),
      targetValue: 1000,
      upValue: 1200,
      currentValue: 1500,
      distributionMode: 'calendar_days',
      goalMethodSnapshot: {
        id: 'integration-tiered', name: 'Faixas', type: 'tiered_unit_bonus', active: true,
        targetPeriod: 'monthly', referenceRevenue: 0,
        tiers: [{ id: 'target', label: 'Meta', fromAmount: 1000, toAmount: null, fixedBonusAmount: 100, excessPercent: 0 }],
        teamBonus: { enabled: true, splitMode: 'equal', eligibleCollaboratorRule: 'all_goal_participants', prorateByAttendance: false },
        leadershipBonus: { enabled: false, factorNumerator: 0, factorDenominator: 1 },
        incentiveMessages: [],
      },
    }),
    seedPublishedCompanyJourney(journeyId),
  ]);

  const candidate = (await listExternalCoverageCandidates({ context, scheduleId: workScheduleId,
    search: 'Cobertura externa', limit: 5 })).candidates.find((person) => person.id === externalUserId);
  assert.deepEqual(candidate?.affiliatedUnitNames, ['Unidade de origem', 'Segunda unidade operacional']);
  assert.equal(candidate?.originUnitName, 'Unidade de origem');

  const input = {
    userId: externalUserId,
    unitId: executionUnitId,
    date: '2026-09-10',
    startTime: '08:00',
    endTime: '16:00',
    type: 'work',
    exceptionReason: 'Cobertura pontual por ausência',
  };
  const restrictedPermissions = structuredClone(defaultGuestPermissions);
  restrictedPermissions.dp.schedules.view = true;
  restrictedPermissions.dp.schedules.edit = true;
  await assert.rejects(
    () => saveWorkShift({
      context: {
        ...context,
        isDefaultAdmin: false,
        userDoc: { ...context.userDoc, unitIds: [executionUnitId] },
        permissions: restrictedPermissions,
      },
      scheduleId: workScheduleId,
      shiftId: shiftRef.id,
      input,
      mode: 'create',
      requestId: 'request-external-forbidden',
    }),
    (error) => error?.code === 'DP_SHIFT_EXTERNAL_FORBIDDEN',
  );
  await assert.rejects(
    () => saveWorkShift({
      context,
      scheduleId: workScheduleId,
      shiftId: shiftRef.id,
      input: { ...input, exceptionReason: undefined },
      mode: 'create',
      requestId: 'request-external-without-reason',
    }),
    (error) => error?.code === 'DP_SHIFT_EXTERNAL_REASON_REQUIRED',
  );

  await saveWorkShift({
    context,
    scheduleId: workScheduleId,
    shiftId: shiftRef.id,
    input,
    mode: 'create',
    requestId: 'request-external-success',
  });
  const persisted = await shiftRef.get();
  assert.equal(persisted.get('assignmentKind'), 'external_coverage');
  assert.equal(persisted.get('originUnitId'), originUnitId);
  assert.equal(persisted.get('countsTowardGoals'), false);
  assert.equal(persisted.get('exceptionReason'), input.exceptionReason);
  assert.equal((await dbAdmin.collection('users').doc(externalUserId).get()).get('unitId'), financialUnitId);
  await assert.rejects(
    () => createEmployeeGoal({
      context,
      requestId: 'request-external-goal-forbidden',
      input: {
        periodId: goalPeriodId,
        employeeId: externalUserId,
        kioskId: goalKioskId,
        participantSource: 'manual',
        participantRole: 'relief',
        scheduledDays: 0,
        scheduledTurnCount: 0,
        fraction: 1,
        targetValue: 1000,
        currentValue: 0,
        distributionMode: 'scheduled_days',
      },
    }),
    (error) => error?.code === 'EMPLOYEE_GOAL_EXTERNAL_COVERAGE_INELIGIBLE',
  );
  await assert.rejects(
    () => createEmployeeGoal({
      context,
      requestId: 'request-invented-goal-shift',
      input: {
        periodId: goalPeriodId,
        employeeId: externalUserId,
        kioskId: goalKioskId,
        shiftId: 'invented-shift',
        fraction: 1,
        targetValue: 1000,
        currentValue: 0,
      },
    }),
    (error) => error?.code === 'EMPLOYEE_GOAL_SHIFT_INVALID',
  );

  const originGoalInput = {
    periodId: originGoalPeriodId,
    employeeId: externalUserId,
    kioskId: originKioskId,
    participantRole: 'fixed',
    fraction: 1,
    targetValue: 1000,
    currentValue: 1500,
  };
  const originGoal = await createEmployeeGoal({
    context,
    requestId: 'request-origin-goal-create',
    input: originGoalInput,
  });
  assert.match(originGoal.id, /^participant_[a-f0-9]{64}$/);
  await assert.rejects(
    () => createEmployeeGoal({
      context,
      requestId: 'request-origin-goal-duplicate',
      input: originGoalInput,
    }),
    (error) => error?.code === 'EMPLOYEE_GOAL_DUPLICATE',
  );

  await dbAdmin.collection('employeeGoals').doc('integration-external-destination-goal').set({
    periodId: goalPeriodId, employeeId: externalUserId, kioskId: goalKioskId,
    participantRole: 'fixed', fraction: 1, targetValue: 1000, currentValue: 1500,
  });
  await transitionGoalPeriod({
    context, periodId: goalPeriodId,
    input: { status: 'closed', closureNote: 'Fechamento de integração' },
    requestId: 'request-close-execution-goal',
  });
  await transitionGoalPeriod({
    context, periodId: originGoalPeriodId,
    input: { status: 'closed', closureNote: 'Fechamento da unidade de origem' },
    requestId: 'request-close-origin-goal',
  });
  const destinationClosure = (await dbAdmin.collection('goalPeriods').doc(goalPeriodId).get()).get('closureSnapshot');
  const originClosure = (await dbAdmin.collection('goalPeriods').doc(originGoalPeriodId).get()).get('closureSnapshot');
  assert.deepEqual(destinationClosure.bonus.participants, []);
  assert.deepEqual(destinationClosure.employeeDateKeysByGoalId, {});
  assert.equal(originClosure.bonus.participants[0].employeeId, externalUserId);
});

test('exclui escala preenchida pela API com autorização e auditoria atômicas', async (t) => {
  const deletionScheduleId = 'integration-schedule-delete';
  const deletionUnitId = 'integration-schedule-delete-unit';
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(deletionScheduleId);

  async function cleanupScheduleDeletionFixture() {
    await clearCollection(scheduleRef.collection('shifts'));
    await Promise.all([
      scheduleRef.delete(),
      dbAdmin.collection('dp_units').doc(deletionUnitId).delete(),
      dbAdmin.collection('dp_bizneo_day_off_operations').doc('integration-schedule-delete-operation').delete(),
    ]);
  }

  await cleanupScheduleDeletionFixture();
  t.after(cleanupScheduleDeletionFixture);
  await Promise.all([
    scheduleRef.set({ name: 'Escala para excluir', year: 2026, month: 9, unitId: deletionUnitId, shiftCount: 2, locked: false, createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(deletionUnitId).set({ name: 'Unidade ativa', createdAt: new Date() }),
    scheduleRef.collection('shifts').doc('one').set({ type: 'work', userId: 'one', unitId: deletionUnitId, date: '2026-09-01' }),
    scheduleRef.collection('shifts').doc('two').set({ type: 'work', userId: 'two', unitId: deletionUnitId, date: '2026-09-02' }),
  ]);

  const restrictedPermissions = structuredClone(defaultGuestPermissions);
  await assert.rejects(
    () => deleteDPSchedule({
      context: { ...context, isDefaultAdmin: false, userDoc: { ...context.userDoc, unitIds: [deletionUnitId] }, permissions: restrictedPermissions },
      scheduleId: deletionScheduleId,
      requestId: 'request-schedule-delete-forbidden',
    }),
    (error) => error?.code === 'DP_SCHEDULE_DELETE_FORBIDDEN',
  );

  await Promise.all([
    scheduleRef.collection('shifts').doc('publishing-day-off').set({
      type: 'day_off', userId: 'one', unitId: deletionUnitId, date: '2026-09-03',
      bizneoOperationId: 'integration-schedule-delete-operation', bizneoSyncStatus: 'publishing',
    }),
    dbAdmin.collection('dp_bizneo_day_off_operations').doc('integration-schedule-delete-operation').set({
      scheduleId: deletionScheduleId, shiftId: 'publishing-day-off', status: 'publishing',
    }),
  ]);
  await assert.rejects(
    () => deleteDPSchedule({ context, scheduleId: deletionScheduleId, requestId: 'request-schedule-delete-bizneo-busy' }),
    (error) => error?.code === 'DP_SCHEDULE_BIZNEO_OPERATION_IN_PROGRESS',
  );
  await Promise.all([
    scheduleRef.collection('shifts').doc('publishing-day-off').delete(),
    dbAdmin.collection('dp_bizneo_day_off_operations').doc('integration-schedule-delete-operation').delete(),
  ]);

  await deleteDPSchedule({ context, scheduleId: deletionScheduleId, requestId: 'request-schedule-delete' });
  const [deletedSchedule, remainingShifts, audit] = await Promise.all([
    scheduleRef.get(),
    scheduleRef.collection('shifts').get(),
    dbAdmin.collection('actionLogs').where('action', '==', 'schedule_deleted').get(),
  ]);
  assert.equal(deletedSchedule.exists, false);
  assert.equal(remainingShifts.empty, true);
  assert.equal(audit.docs.filter((document) => document.get('metadata.schedule_id') === deletionScheduleId).length, 1);
});

test('preserva identidade Bizneo e impede excluir turno vinculado a jornada', async (t) => {
  const shiftCode = 'integration-bizneo-preserved';
  let shiftId = '';
  let journeyId = '';
  let successorJourneyId = '';

  async function cleanupTimeConfigFixture() {
    if (journeyId) await dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(journeyId).delete();
    if (successorJourneyId) await dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(successorJourneyId).delete();
    if (shiftId) await dbAdmin.collection('dp_shiftDefinitions').doc(shiftId).delete();
    const [staleShifts, staleJourneys] = await Promise.all([
      dbAdmin.collection('dp_shiftDefinitions').where('code', '==', shiftCode).get(),
      dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).where('name', '==', 'Jornada de integração').get(),
    ]);
    const batch = dbAdmin.batch();
    staleShifts.docs.forEach((document) => batch.delete(document.ref));
    staleJourneys.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }

  await cleanupTimeConfigFixture();
  t.after(cleanupTimeConfigFixture);
  const shift = await createShiftDefinition({
    context,
    requestId: 'request-shift-create',
    input: {
      code: shiftCode,
      name: 'Turno Bizneo de integração',
      bizneoTemplateId: 'bizneo-integration-123',
      startTime: '08:00',
      endTime: '16:00',
      breakType: 'flexible',
      breakDurationMinutes: 60,
      daysOfWeek: [1, 2, 3, 4, 5, 6],
      description: 'Configuração inicial',
      expectedPunches: 4,
    },
  });
  shiftId = shift.id;
  await updateShiftDefinition({
    context,
    id: shiftId,
    requestId: 'request-shift-metadata-update',
    input: { description: 'Metadado interno atualizado', expectedPunches: null },
  });
  assert.equal((await dbAdmin.collection('dp_shiftDefinitions').doc(shiftId).get()).get('expectedPunches'), undefined);
  await assert.rejects(
    () => updateShiftDefinition({
      context,
      id: shiftId,
      requestId: 'request-shift-bizneo-change',
      input: { name: 'Nome Bizneo alterado' },
    }),
    (error) => error?.code === 'DP_SHIFT_BIZNEO_IDENTITY_IMMUTABLE',
  );

  const journey = await createTimeConfig({
    context,
    collectionName: DP_TIME_COLLECTIONS.journeys,
    requestId: 'request-journey-create',
    input: {
      name: 'Jornada de integração',
      weeklyMinutes: 2640,
      cycleLengthDays: 7,
      days: [1, 2, 3, 4, 5, 6].map((dayIndex) => ({ dayIndex, plannedMinutes: 440, isRestDay: false })).concat([{ dayIndex: 7, plannedMinutes: 0, isRestDay: true }]),
      regime: { mode: 'flexible', windowStart: '06:00', windowEnd: '22:00' },
      allowedShiftDefinitionIds: [shiftId],
      applicability: { scope: { kind: 'company' } },
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      description: 'Descrição removível',
    },
  });
  journeyId = journey.id;
  assert.deepEqual((await dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(journeyId).get()).get('regime'), {
    mode: 'flexible',
    windowStart: '06:00',
    windowEnd: '22:00',
  });
  await assert.rejects(
    () => deleteShiftDefinition({ context, id: shiftId, requestId: 'request-shift-delete-in-use' }),
    (error) => error?.code === 'DP_SHIFT_DEFINITION_IN_USE',
  );

  const shiftManagerPermissions = structuredClone(defaultGuestPermissions);
  shiftManagerPermissions.dp.settings.manageShifts = true;
  await assert.rejects(
    () => updateShiftDefinition({
      context: { ...context, isDefaultAdmin: false, userDoc: { ...context.userDoc, unitAccessScope: 'all' }, permissions: shiftManagerPermissions },
      id: shiftId,
      requestId: 'request-shift-link-without-time-permission',
      input: { journeyIds: [journeyId] },
    }),
    (error) => error?.code === 'DP_TIME_CONFIG_FORBIDDEN',
  );
  shiftManagerPermissions.dp.settings.manageTime = true;
  await assert.rejects(
    () => updateShiftDefinition({
      context: { ...context, isDefaultAdmin: false, userDoc: { ...context.userDoc, unitIds: ['unit-limited'] }, permissions: shiftManagerPermissions },
      id: shiftId,
      requestId: 'request-shift-link-without-global-scope',
      input: { journeyIds: [journeyId] },
    }),
    (error) => error?.code === 'DP_TIME_GLOBAL_SCOPE_REQUIRED',
  );

  await updateTimeConfig({
    context,
    collectionName: DP_TIME_COLLECTIONS.journeys,
    id: journeyId,
    requestId: 'request-journey-clear-optionals',
    input: { action: 'update', data: { description: null, validTo: null, allowedShiftDefinitionIds: null } },
  });
  const clearedJourney = await dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(journeyId).get();
  assert.equal(clearedJourney.get('description'), undefined);
  assert.equal(clearedJourney.get('validTo'), undefined);
  assert.equal(clearedJourney.get('allowedShiftDefinitionIds'), undefined);

  await updateTimeConfig({
    context,
    collectionName: DP_TIME_COLLECTIONS.journeys,
    id: journeyId,
    requestId: 'request-journey-publish',
    input: { action: 'publish' },
  });
  await updateShiftDefinition({
    context,
    id: shiftId,
    requestId: 'request-shift-link-published-journey',
    input: { journeyIds: [journeyId] },
  });
  const successor = await createTimeConfig({
    context,
    collectionName: DP_TIME_COLLECTIONS.journeys,
    requestId: 'request-journey-successor-create',
    input: {
      supersedesId: journeyId,
      name: 'Jornada de integração',
      weeklyMinutes: 2640,
      cycleLengthDays: 7,
      days: [1, 2, 3, 4, 5, 6].map((dayIndex) => ({ dayIndex, plannedMinutes: 440, isRestDay: false })).concat([{ dayIndex: 7, plannedMinutes: 0, isRestDay: true }]),
      regime: { mode: 'fixed' },
      applicability: { scope: { kind: 'company' } },
      validFrom: '2027-01-01',
    },
  });
  successorJourneyId = successor.id;
  await updateTimeConfig({
    context,
    collectionName: DP_TIME_COLLECTIONS.journeys,
    id: successorJourneyId,
    requestId: 'request-journey-successor-publish',
    input: { action: 'publish' },
  });
  const archivedJourney = await dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(journeyId).get();
  assert.equal(archivedJourney.get('status'), 'archived');
  assert.equal(archivedJourney.get('validTo'), '2026-12-31');
  await updateShiftDefinition({
    context,
    id: shiftId,
    requestId: 'request-shift-edit-with-archived-journey',
    input: { description: 'Editado sem perder vínculo histórico' },
  });
  assert.deepEqual((await dbAdmin.collection('dp_shiftDefinitions').doc(shiftId).get()).get('journeyIds'), [journeyId]);

  await Promise.all([
    dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(journeyId).delete(),
    dbAdmin.collection(DP_TIME_COLLECTIONS.journeys).doc(successorJourneyId).delete(),
  ]);
  journeyId = '';
  successorJourneyId = '';
  await updateShiftDefinition({
    context,
    id: shiftId,
    requestId: 'request-shift-archive',
    input: { isArchived: true },
  });
  await deleteShiftDefinition({ context, id: shiftId, requestId: 'request-shift-delete' });
  assert.equal((await dbAdmin.collection('dp_shiftDefinitions').doc(shiftId).get()).exists, false);
  shiftId = '';
});
