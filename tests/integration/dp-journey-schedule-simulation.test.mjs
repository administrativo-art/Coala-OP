import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const PROJECT_ID = 'demo-coala-repository';
const DATABASE_ID = 'coala';

assertFirestoreEmulatorSafety({ projectId: PROJECT_ID, databaseId: DATABASE_ID });

const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { validateScheduleJourneys } = await import('../../src/features/dp/journey-validation/service.server.ts');
const { changeDPScheduleLock } = await import('../../src/features/dp/schedules/state-service.server.ts');

const ids = {
  actor: 'journey-simulation-admin',
  currentSchedule: 'journey-simulation-2026-10',
  previousSchedule: 'journey-simulation-2026-09',
  primaryUnit: 'journey-simulation-unit-primary',
  supportUnit: 'journey-simulation-unit-support',
  alice: 'journey-simulation-alice',
  bruno: 'journey-simulation-bruno',
  clara: 'journey-simulation-clara',
  companyJourney: 'journey-simulation-company-6x1',
  functionJourney: 'journey-simulation-function-5x2',
  manualJourney: 'journey-simulation-clara-12x36',
};

const context = {
  decoded: { uid: ids.actor },
  userDoc: { id: ids.actor, username: 'Admin da simulação' },
  profileId: null,
  permissions: structuredClone(defaultAdminPermissions),
  isDefaultAdmin: true,
  workspace_id: 'coala-one',
};

function journey(overrides) {
  const id = overrides.id;
  const max = overrides.maxConsecutiveWorkDays;
  return {
    lineageId: id,
    version: 1,
    status: 'published',
    name: overrides.name,
    weeklyMinutes: 2_400,
    cycleLengthDays: max + 1,
    days: Array.from({ length: max + 1 }, (_, dayIndex) => ({
      dayIndex,
      plannedMinutes: dayIndex === max ? 0 : Math.floor(2_400 / max),
      isRestDay: dayIndex === max,
    })),
    regime: { mode: 'fixed' },
    weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: max },
    scaleValidation: { mode: overrides.validationMode ?? 'consecutive_days' },
    allowedShiftDefinitionIds: [],
    applicability: overrides.applicability,
    validFrom: '2026-01-01',
    createdAt: new Date(),
    createdBy: ids.actor,
    updatedAt: new Date(),
    updatedBy: ids.actor,
    publishedAt: new Date(),
    publishedBy: ids.actor,
  };
}

async function clearCollection(reference) {
  const snapshot = await reference.get();
  if (snapshot.empty) return;
  const batch = dbAdmin.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
}

async function cleanup() {
  await Promise.all([
    clearCollection(dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).collection('shifts')),
    clearCollection(dbAdmin.collection('dp_schedules').doc(ids.previousSchedule).collection('shifts')),
  ]);
  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).delete(),
    dbAdmin.collection('dp_schedules').doc(ids.previousSchedule).delete(),
    dbAdmin.collection('dp_units').doc(ids.primaryUnit).delete(),
    dbAdmin.collection('dp_units').doc(ids.supportUnit).delete(),
    dbAdmin.collection('users').doc(ids.alice).delete(),
    dbAdmin.collection('users').doc(ids.bruno).delete(),
    dbAdmin.collection('users').doc(ids.clara).delete(),
    dbAdmin.collection('dp_journeys').doc(ids.companyJourney).delete(),
    dbAdmin.collection('dp_journeys').doc(ids.functionJourney).delete(),
    dbAdmin.collection('dp_journeys').doc(ids.manualJourney).delete(),
  ]);
  const audit = await dbAdmin.collection('actionLogs')
    .where('module', '==', 'dp.schedules')
    .get();
  if (!audit.empty) {
    const batch = dbAdmin.batch();
    audit.docs
      .filter((document) => document.get('metadata.schedule_id') === ids.currentSchedule)
      .forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

function addShift(batch, scheduleId, userId, date, type, unitId = ids.primaryUnit) {
  const documentId = `${userId}-${date}-${type}`;
  batch.set(dbAdmin.collection('dp_schedules').doc(scheduleId).collection('shifts').doc(documentId), {
    scheduleId,
    userId,
    unitId,
    date,
    type,
    startTime: type === 'work' ? '08:00' : '',
    endTime: type === 'work' ? '16:00' : '',
    createdAt: new Date(),
  });
}

function addPattern(batch, userId, workDays, restDays) {
  workDays.forEach((day) => addShift(batch, ids.currentSchedule, userId, `2026-10-${String(day).padStart(2, '0')}`, 'work'));
  restDays.forEach((day) => addShift(batch, ids.currentSchedule, userId, `2026-10-${String(day).padStart(2, '0')}`, 'day_off'));
}

test('simula escala mensal mista, continuidade, bloqueios e novo fechamento', async (t) => {
  await cleanup();
  t.after(cleanup);

  await Promise.all([
    dbAdmin.collection('dp_units').doc(ids.primaryUnit).set({ name: 'Unidade principal', createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(ids.supportUnit).set({ name: 'Unidade de apoio', createdAt: new Date() }),
    dbAdmin.collection('users').doc(ids.alice).set({ username: 'Alice 6×1', isActive: true, unitId: ids.primaryUnit, unitIds: [ids.primaryUnit] }),
    dbAdmin.collection('users').doc(ids.bruno).set({ username: 'Bruno 5×2', isActive: true, unitId: ids.primaryUnit, unitIds: [ids.primaryUnit], jobFunctionIds: ['function-5x2'] }),
    dbAdmin.collection('users').doc(ids.clara).set({ username: 'Clara 12×36', isActive: true, unitId: ids.primaryUnit, unitIds: [ids.primaryUnit] }),
    dbAdmin.collection('dp_journeys').doc(ids.companyJourney).set(journey({
      id: ids.companyJourney,
      name: 'Jornada 6×1 da empresa',
      maxConsecutiveWorkDays: 6,
      applicability: { scope: { kind: 'company' } },
    })),
    dbAdmin.collection('dp_journeys').doc(ids.functionJourney).set(journey({
      id: ids.functionJourney,
      name: 'Jornada 5×2 da função',
      maxConsecutiveWorkDays: 5,
      applicability: { scope: { kind: 'company' }, jobFunctionIds: ['function-5x2'] },
    })),
    dbAdmin.collection('dp_journeys').doc(ids.manualJourney).set(journey({
      id: ids.manualJourney,
      name: 'Jornada 12×36 da Clara',
      maxConsecutiveWorkDays: 1,
      validationMode: 'manual_review',
      applicability: { scope: { kind: 'company' }, collaboratorIds: [ids.clara] },
    })),
    dbAdmin.collection('dp_schedules').doc(ids.previousSchedule).set({
      name: 'Setembro de 2026', year: 2026, month: 9, unitId: ids.supportUnit, shiftCount: 5, locked: true, createdAt: new Date(),
    }),
    dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).set({
      name: 'Outubro de 2026', year: 2026, month: 10, unitId: ids.primaryUnit, shiftCount: 0, locked: false, journeyValidationVersion: 1, createdAt: new Date(),
    }),
  ]);

  const batch = dbAdmin.batch();
  ['2026-09-28', '2026-09-29', '2026-09-30'].forEach((date) => addShift(batch, ids.previousSchedule, ids.alice, date, 'work', ids.supportUnit));
  ['2026-09-29', '2026-09-30'].forEach((date) => addShift(batch, ids.previousSchedule, ids.bruno, date, 'work', ids.supportUnit));
  addPattern(batch, ids.alice,
    [1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31],
    [4, 11, 18, 25]);
  addPattern(batch, ids.bruno,
    [1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 29, 30, 31],
    [4, 10, 16, 22, 28]);
  await batch.commit();

  const valid = await validateScheduleJourneys({ context, scheduleId: ids.currentSchedule });
  assert.equal(valid.status, 'ok');
  assert.equal(valid.people[ids.alice].journey?.id, ids.companyJourney);
  assert.equal(valid.people[ids.alice].journey?.maxConsecutiveWorkDays, 6);
  assert.equal(valid.people[ids.alice].carryInConsecutiveDays, 3);
  assert.equal(valid.people[ids.alice].countsByDate['2026-10-03'], 6);
  assert.ok(valid.people[ids.alice].predictedDayOffDates.includes('2026-10-04'));
  assert.equal(valid.people[ids.bruno].journey?.id, ids.functionJourney);
  assert.equal(valid.people[ids.bruno].journey?.maxConsecutiveWorkDays, 5);
  assert.equal(valid.people[ids.bruno].carryInConsecutiveDays, 2);
  assert.equal(valid.people[ids.bruno].countsByDate['2026-10-03'], 5);

  const firstLock = await changeDPScheduleLock({
    context,
    scheduleId: ids.currentSchedule,
    action: 'lock',
    snapshot: { users: {} },
    requestId: 'journey-simulation-lock-valid',
  });
  assert.equal(firstLock.locked, true);
  assert.equal((await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).get()).get('journeyValidation.status'), 'ok');

  await changeDPScheduleLock({ context, scheduleId: ids.currentSchedule, action: 'unlock', requestId: 'journey-simulation-unlock-before-violation' });
  const aliceDayOff = dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).collection('shifts').doc(`${ids.alice}-2026-10-04-day_off`);
  await aliceDayOff.delete();
  await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).collection('shifts').doc(`${ids.alice}-2026-10-04-work`).set({
    scheduleId: ids.currentSchedule,
    userId: ids.alice,
    unitId: ids.primaryUnit,
    date: '2026-10-04',
    type: 'work',
    startTime: '08:00',
    endTime: '16:00',
    createdAt: new Date(),
  });
  await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).update({ journeyValidationVersion: 2 });

  const invalid = await validateScheduleJourneys({ context, scheduleId: ids.currentSchedule });
  assert.equal(invalid.status, 'blocked');
  assert.ok(invalid.issues.some((issue) => issue.code === 'MAX_CONSECUTIVE_DAYS_EXCEEDED' && issue.userId === ids.alice && issue.date === '2026-10-04'));
  await assert.rejects(
    () => changeDPScheduleLock({
      context,
      scheduleId: ids.currentSchedule,
      action: 'lock',
      snapshot: { users: {} },
      requestId: 'journey-simulation-lock-invalid',
    }),
    (error) => error?.code === 'DP_SCHEDULE_JOURNEY_VALIDATION_BLOCKED',
  );
  assert.equal((await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).get()).get('locked'), false);

  await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).collection('shifts').doc(`${ids.alice}-2026-10-04-work`).delete();
  await aliceDayOff.set({
    scheduleId: ids.currentSchedule,
    userId: ids.alice,
    unitId: ids.primaryUnit,
    date: '2026-10-04',
    type: 'day_off',
    startTime: '',
    endTime: '',
    createdAt: new Date(),
  });
  await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).update({ journeyValidationVersion: 3 });
  const secondLock = await changeDPScheduleLock({
    context,
    scheduleId: ids.currentSchedule,
    action: 'lock',
    snapshot: { users: {} },
    requestId: 'journey-simulation-lock-corrected',
  });
  assert.equal(secondLock.locked, true);
  assert.equal(secondLock.validation?.version, 3);

  await changeDPScheduleLock({ context, scheduleId: ids.currentSchedule, action: 'unlock', requestId: 'journey-simulation-unlock-before-manual' });
  await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).collection('shifts').doc(`${ids.clara}-2026-10-01-work`).set({
    scheduleId: ids.currentSchedule,
    userId: ids.clara,
    unitId: ids.primaryUnit,
    date: '2026-10-01',
    type: 'work',
    startTime: '08:00',
    endTime: '20:00',
    createdAt: new Date(),
  });
  await dbAdmin.collection('dp_schedules').doc(ids.currentSchedule).update({ journeyValidationVersion: 4 });
  const manual = await validateScheduleJourneys({ context, scheduleId: ids.currentSchedule });
  assert.equal(manual.status, 'blocked');
  assert.equal(manual.people[ids.clara].status, 'manual_review');
  assert.ok(manual.issues.some((issue) => issue.code === 'JOURNEY_MANUAL_REVIEW' && issue.userId === ids.clara));
});
