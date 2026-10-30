import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { Timestamp } = await import('firebase-admin/firestore');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { readOwnRepPMonth, readRepPMonthOfPerson } = await import('../../src/features/dp/rep-p/own-month.server.ts');
const { externalCoverageUnits, allowedExecutionUnit } = await import('../../src/features/dp/rep-p/execution-units.server.ts');

test('cobertura externa libera a unidade somente no dia e na escala vigente da própria pessoa', async () => {
  const prefix = 'rep-p-external-coverage';
  const date = '2027-05-12';
  const uid = `${prefix}-employee`;
  const origin = `${prefix}-origin`;
  const destination = `${prefix}-destination`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-official`);
  const stale = dbAdmin.collection('dp_schedules').doc(`${prefix}-stale`);
  const shift = schedule.collection('shifts').doc('coverage');
  await Promise.all([
    schedule.set({ year: 2027, month: 5, unitId: destination, locked: true, createdAt: Timestamp.fromMillis(2_000) }),
    stale.set({ year: 2027, month: 5, unitId: destination, locked: false, createdAt: Timestamp.fromMillis(3_000) }),
    shift.set({ userId: uid, unitId: destination, originUnitId: origin, date, type: 'work',
      assignmentKind: 'external_coverage', exceptionReason: 'Cobertura autorizada pelo DP' }),
    stale.collection('shifts').doc('stale').set({ userId: uid, unitId: destination, originUnitId: origin, date: '2027-05-13',
      type: 'work', assignmentKind: 'external_coverage', exceptionReason: 'Escala substituída' }),
  ]);
  assert.deepEqual(await externalCoverageUnits(dbAdmin, uid, date, [origin]), [destination]);
  assert.deepEqual(await externalCoverageUnits(dbAdmin, uid, date, ['unrelated-origin']), []);
  assert.equal(await allowedExecutionUnit(dbAdmin, uid, date, [origin], destination), true);
  assert.equal(await allowedExecutionUnit(dbAdmin, uid, date, [origin], origin), true);
  assert.equal(await allowedExecutionUnit(dbAdmin, uid, '2027-05-13', [origin], destination), false);
  assert.deepEqual(await externalCoverageUnits(dbAdmin, `${prefix}-other`, date, [origin]), []);
  await shift.update({ overnight: true });
  assert.equal(await allowedExecutionUnit(dbAdmin, uid, '2027-05-13', [origin], destination), true);
  await shift.update({ exceptionReason: '' });
  assert.deepEqual(await externalCoverageUnits(dbAdmin, uid, date, [origin]), []);
  await shift.update({ exceptionReason: 'Cobertura autorizada pelo DP', type: 'day_off' });
  assert.deepEqual(await externalCoverageUnits(dbAdmin, uid, date, [origin]), []);
});

test('escala do mês do Registro de ponto lê só os turnos da pessoa na escala oficial de cada unidade', async () => {
  const prefix = 'rep-p-month';
  const userId = `${prefix}-employee`;
  const otherId = `${prefix}-other`;
  const unitId = `${prefix}-unit`;
  const context = { decoded: { uid: userId }, userDoc: { id: userId }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: false, workspace_id: 'coala-one' };
  const official = dbAdmin.collection('dp_schedules').doc(`${prefix}-official`);
  const stale = dbAdmin.collection('dp_schedules').doc(`${prefix}-stale`);
  const definition = dbAdmin.collection('dp_shiftDefinitions').doc(`${prefix}-manha`);
  const unit = dbAdmin.collection('dp_units').doc(unitId);
  // Versão publicada da jornada citada pelo turno: a tolerância vem dela, não do cadastro vivo.
  const journeyV1 = dbAdmin.collection('dp_journeys').doc(`${prefix}-journey-v1`);
  const journeyV2 = dbAdmin.collection('dp_journeys').doc(`${prefix}-journey-v2`);
  const shift = (schedule, id, data) => schedule.collection('shifts').doc(id).set({ scheduleId: schedule.id, unitId, type: 'work', ...data });

  await Promise.all([
    official.set({ year: 2027, month: 3, unitId, locked: true, createdAt: Timestamp.fromMillis(1_000), calendarId: `${prefix}-calendar` }),
    // Feriado do calendário da escala oficial; ponto facultativo não conta para o banco.
    dbAdmin.collection('dp_calendars').doc(`${prefix}-calendar`).collection('holidays').doc('a').set({ name: 'Feriado', type: 'municipal', date: Timestamp.fromDate(new Date('2027-03-19T03:00:00Z')) }),
    dbAdmin.collection('dp_calendars').doc(`${prefix}-calendar`).collection('holidays').doc('b').set({ name: 'Facultativo', type: 'optional', date: Timestamp.fromDate(new Date('2027-03-20T03:00:00Z')) }),
    stale.set({ year: 2027, month: 3, unitId, locked: false, createdAt: Timestamp.fromMillis(9_000) }),
    definition.set({ name: 'Manhã', breakType: 'staggered', breakDurationMinutes: 15, breakWindowStart: '12:00', breakWindowEnd: '14:00', expectedPunches: 4 }),
    unit.set({ name: 'Quiosque Teste' }),
    journeyV1.set({ lineageId: `${prefix}-journey`, version: 1, status: 'archived', toleranceMinutes: 5 }),
    journeyV2.set({ lineageId: `${prefix}-journey`, version: 2, status: 'published', toleranceMinutes: 8 }),
  ]);
  await Promise.all([
    shift(official, 'a', { userId, date: '2027-03-02', startTime: '10:00', endTime: '16:15', shiftDefinitionId: definition.id,
      journeyResolution: { journeyId: journeyV1.id, lineageId: `${prefix}-journey`, version: 1 } }),
    shift(official, 'b', { userId, date: '2027-03-03', type: 'day_off', startTime: '00:00', endTime: '00:00' }),
    shift(official, 'c', { userId: otherId, date: '2027-03-02', startTime: '08:00', endTime: '14:00' }),
    shift(official, 'd', { userId, date: '2027-04-01', startTime: '10:00', endTime: '16:15' }),
    // Escala mais nova, mas não trancada: a oficial da unidade é a trancada, como em Minha escala.
    shift(stale, 'e', { userId, date: '2027-03-02', startTime: '07:00', endTime: '13:00' }),
  ]);

  const result = await readOwnRepPMonth(context, { month: '2027-03' });
  assert.equal(result.month, '2027-03');
  assert.equal(result.truncated, false);
  assert.deepEqual(result.shifts.map((item) => [item.date, item.type, item.startTime]), [['2027-03-02', 'work', '10:00'], ['2027-03-03', 'day_off', '00:00']]);
  assert.deepEqual(result.shifts[0], {
    date: '2027-03-02', type: 'work', startTime: '10:00', endTime: '16:15', overnight: false, unitId, unitName: 'Quiosque Teste', assignmentKind: 'regular', unitTimeZone: null,
    shiftName: 'Manhã', breakType: 'staggered', breakStart: null, breakEnd: null, breakDurationMinutes: 15,
    breakWindowStart: '12:00', breakWindowEnd: '14:00', expectedPunches: 4, executionUnitPolicy: 'scheduled', locationTrackingPolicy: 'disabled',
    breakSegments: null, breakSplit: 'single', breakPauseCount: null,
    breakMinPauseMinutes: null, toleranceMinutes: 5, journeyId: `${prefix}-journey-v1`, referenceMinutes: null,
  });
  assert.equal(result.shifts[1].toleranceMinutes, null);
  assert.equal(result.holidays.length, 0);
  assert.deepEqual((await readRepPMonthOfPerson([userId], '2027-03', {}, { holidays: true })).holidays, ['2027-03-19']);
  await assert.rejects(readOwnRepPMonth(context, { month: '2027-13' }), { code: 'REP_P_MONTH_INPUT_INVALID' });
  await assert.rejects(readOwnRepPMonth(context, { month: '2027-03', userId: otherId }), { code: 'REP_P_MONTH_INPUT_INVALID' });
});

test('fuso da unidade para o ponto: grava, registra histórico e volta ao do estabelecimento', async () => {
  const { setUnitTimeZone } = await import('../../src/features/dp/rep-p/unit-time-zone.server.ts');
  const unit = dbAdmin.collection('dp_units').doc('rep-p-tz-unit');
  await unit.set({ name: 'Quiosque Manaus' });
  const context = { decoded: { uid: 'rep-p-tz-admin' }, userDoc: { id: 'rep-p-tz-admin' }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: 'coala-one' };
  assert.deepEqual(await setUnitTimeZone(context, unit.id, { timeZone: 'America/Manaus' }), { timeZone: 'America/Manaus', changed: true });
  assert.deepEqual(await setUnitTimeZone(context, unit.id, { timeZone: 'America/Manaus' }), { timeZone: 'America/Manaus', changed: false });
  assert.equal((await unit.get()).get('timeZone'), 'America/Manaus');
  await setUnitTimeZone(context, unit.id, { timeZone: null });
  assert.equal((await unit.get()).get('timeZone'), undefined);
  const history = (await unit.collection('timeZoneHistory').get()).docs.map((doc) => [doc.get('previous'), doc.get('next'), doc.get('actorUid')]);
  assert.deepEqual(history.sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [['America/Manaus', null, 'rep-p-tz-admin'], [null, 'America/Manaus', 'rep-p-tz-admin']]);
  await assert.rejects(setUnitTimeZone(context, 'rep-p-tz-missing', { timeZone: 'America/Manaus' }), { code: 'DP_UNIT_NOT_FOUND' });
});
