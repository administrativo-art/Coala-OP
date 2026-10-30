import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { saveWorkShift } = await import('../../src/features/dp/shifts/service.server.ts');
const { applyWorkShiftBulkChange } = await import('../../src/features/dp/shifts/bulk-service.server.ts');
const { personAgendaClockRef, readPersonAgendaVersion } = await import('../../src/features/dp/shifts/agenda-clock.server.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { assertCoverageCompetenceOpen } = await import('../../src/features/dp/absences/coverage/service.server.ts');
const { CLOSURES, closureKey } = await import('../../src/features/dp/time-adjustments/service.server.ts');

test('referência privada preserva empregador e revisões após edição e exclusão', async () => {
  const prefix = 'reference-integration';
  const userId = `${prefix}-user`;
  const scheduleId = `${prefix}-schedule`;
  const origin = `${prefix}-origin`;
  const destination = `${prefix}-destination`;
  const journeyId = `${prefix}-journey`;
  const definitionId = `${prefix}-definition`;
  const context = { decoded: { uid: prefix }, userDoc: { id: prefix, username: 'Teste' },
    profileId: null, permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: 'coala-one' };
  const user = dbAdmin.collection('users').doc(userId);
  const schedule = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const definition = dbAdmin.collection('dp_shiftDefinitions').doc(definitionId);
  const journey = dbAdmin.collection('dp_journeys').doc(journeyId);
  const shift = schedule.collection('shifts').doc('work');
  const units = [origin, destination].map(id => dbAdmin.collection('dp_units').doc(id));
  const input = { userId, unitId: destination, date: '2026-10-20', startTime: '08:00', endTime: '14:15',
    shiftDefinitionId: definitionId, exceptionReason: 'Cobertura excepcional de teste' };
  try {
    await Promise.all([
      ...units.map(ref => ref.set({ name: ref.id, isArchived: false })),
      user.set({ isActive: true, unitId: origin, unitIds: [origin], employerUnitId: origin,
        employerCnpj: '14276603000125', employmentRelationshipType: 'clt' }),
      schedule.set({ month: 10, year: 2026, unitId: destination, locked: false, shiftCount: 0 }),
      definition.set({ name: 'Turno', startTime: '08:00', endTime: '14:15', breakType: 'fixed',
        breakStart: '11:00', breakEnd: '11:15', journeyIds: [journeyId] }),
      journey.set({ lineageId: journeyId, version: 1, status: 'published', name: 'Jornada',
        validFrom: '2026-01-01', weeklyMinutes: 2640, cycleLengthDays: 7,
        days: [{ dayIndex: 0, plannedMinutes: 440, isRestDay: false }],
        applicability: { scope: { kind: 'company' }, collaboratorIds: [userId] }, allowedShiftDefinitionIds: [] }),
    ]);
    await saveWorkShift({ context, scheduleId, shiftId: shift.id, input, mode: 'create', requestId: 'create' });
    const first = await shift.get();
    assert.equal(first.get('reference'), undefined);
    const firstRef = dbAdmin.collection('dp_shiftReferenceHistory').doc(first.get('referenceRevisionId'));
    const original = (await firstRef.get()).data();
    assert.equal(original.userId, userId);
    assert.equal(original.reference.collaborator.employerUnitId, origin);
    assert.equal(original.reference.executionUnitId, destination);
    assert.equal(original.reference.collaborator.employmentCycleStatus, 'pending');
    await user.update({ employerUnitId: destination, jobRoleId: 'changed' });
    await definition.update({ breakStart: '12:00', breakEnd: '12:15' });
    assert.deepEqual((await firstRef.get()).data(), original);
    await saveWorkShift({ context, scheduleId, shiftId: shift.id, input, mode: 'update', requestId: 'update' });
    const revisedId = (await shift.get()).get('referenceRevisionId');
    assert.notEqual(revisedId, firstRef.id);
    assert.equal((await dbAdmin.collection('dp_shiftReferenceHistory').doc(revisedId).get()).get('previousRevisionId'), firstRef.id);
    await applyWorkShiftBulkChange({ context, scheduleId, requestId: 'bulk', input: {
      action: 'replace', shiftIds: [shift.id], patch: { startTime: '09:00', endTime: '15:00', shiftDefinitionId: null },
    } });
    const bulk = await shift.get();
    assert.equal(bulk.get('shiftDefinitionId'), undefined);
    const bulkRef = await dbAdmin.collection('dp_shiftReferenceHistory').doc(bulk.get('referenceRevisionId')).get();
    assert.equal(bulkRef.get('reference.shiftDefinition'), null);
    assert.equal(bulkRef.get('previousRevisionId'), revisedId);
    await applyWorkShiftBulkChange({ context, scheduleId, requestId: 'bulk-again', input: {
      action: 'replace', shiftIds: [shift.id], patch: { startTime: '10:00', endTime: '16:00', shiftDefinitionId: null },
    } });
    const nextRef = await dbAdmin.collection('dp_shiftReferenceHistory').doc((await shift.get()).get('referenceRevisionId')).get();
    assert.equal(nextRef.get('reference.basisCapturedAt'), bulkRef.get('reference.basisCapturedAt'));
    assert.equal(nextRef.get('previousRevisionId'), bulkRef.id);
    await applyWorkShiftBulkChange({ context, scheduleId, requestId: 'delete', input: { action: 'delete', shiftIds: [shift.id] } });
    assert.equal((await shift.get()).exists, false);
    assert.deepEqual((await firstRef.get()).data(), original);
  } finally {
    const history = await dbAdmin.collection('dp_shiftReferenceHistory').where('scheduleId', '==', scheduleId).limit(20).get();
    const logs = await dbAdmin.collection('actionLogs').where('metadata.schedule_id', '==', scheduleId).limit(20).get();
    await Promise.all([...history.docs, ...logs.docs].map(doc => doc.ref.delete()));
    await Promise.all([user, schedule, shift, definition, journey, ...units].map(ref => ref.delete()));
  }
});

test('cadeado da agenda: gravação sobe a versão e conferência velha é recusada, inclusive em gravações simultâneas', async () => {
  const prefix = 'agenda-clock-integration';
  const userId = `${prefix}-user`;
  const scheduleId = `${prefix}-schedule`;
  const unitId = `${prefix}-unit`;
  const journeyId = `${prefix}-journey`;
  const context = { decoded: { uid: prefix }, userDoc: { id: prefix, username: 'Teste' },
    profileId: null, permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: 'coala-one' };
  const user = dbAdmin.collection('users').doc(userId);
  const schedule = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const unit = dbAdmin.collection('dp_units').doc(unitId);
  const journey = dbAdmin.collection('dp_journeys').doc(journeyId);
  const clock = personAgendaClockRef('coala-one', userId);
  const shiftIds = ['first', 'stale', 'race-a', 'race-b'];
  const input = (date, startTime, endTime) => ({ userId, unitId, date, startTime, endTime });
  try {
    await Promise.all([
      unit.set({ name: unitId, isArchived: false }),
      user.set({ isActive: true, unitId, unitIds: [unitId], employmentRelationshipType: 'clt' }),
      schedule.set({ month: 10, year: 2026, unitId, locked: false, shiftCount: 0 }),
      journey.set({ lineageId: journeyId, version: 1, status: 'published', name: 'Jornada',
        validFrom: '2026-01-01', weeklyMinutes: 2640, cycleLengthDays: 7,
        days: [{ dayIndex: 0, plannedMinutes: 440, isRestDay: false }],
        applicability: { scope: { kind: 'company' }, collaboratorIds: [userId] }, allowedShiftDefinitionIds: [] }),
    ]);
    assert.equal(await readPersonAgendaVersion('coala-one', userId), 0);
    await saveWorkShift({ context, scheduleId, shiftId: 'first', mode: 'create', requestId: 'first', input: input('2026-10-05', '08:00', '14:00') });
    assert.equal(await readPersonAgendaVersion('coala-one', userId), 1);

    await assert.rejects(
      saveWorkShift({ context, scheduleId, shiftId: 'stale', mode: 'create', requestId: 'stale', expectedAgendaVersion: 0,
        input: input('2026-10-06', '08:00', '14:00') }),
      (error) => error.code === 'DP_SHIFT_AGENDA_CHANGED');
    assert.equal((await schedule.collection('shifts').doc('stale').get()).exists, false);

    const results = await Promise.allSettled(['race-a', 'race-b'].map((shiftId) => saveWorkShift({
      context, scheduleId, shiftId, mode: 'create', requestId: shiftId, expectedAgendaVersion: 1,
      input: input('2026-10-07', '08:00', '14:00') })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'DP_SHIFT_AGENDA_CHANGED');
    assert.equal(await readPersonAgendaVersion('coala-one', userId), 2);
  } finally {
    const history = await dbAdmin.collection('dp_shiftReferenceHistory').where('scheduleId', '==', scheduleId).limit(20).get();
    const logs = await dbAdmin.collection('actionLogs').where('metadata.schedule_id', '==', scheduleId).limit(20).get();
    await Promise.all([...history.docs, ...logs.docs].map(doc => doc.ref.delete()));
    await Promise.all([...shiftIds.map(id => schedule.collection('shifts').doc(id)), user, schedule, unit, journey, clock].map(ref => ref.delete()));
  }
});

test('cobertura recusa turno em mês já fechado pelo DP e aceita em mês aberto ou reaberto', async () => {
  const workspaceId = 'coverage-closure-integration';
  const closure = hrDbAdmin.collection(CLOSURES).doc(closureKey(workspaceId, '2026-09-15'));
  try {
    await assertCoverageCompetenceOpen(workspaceId, '2026-09-15');
    await closure.set({ workspaceId, competence: '2026-09', status: 'closed', version: 1 });
    await assert.rejects(assertCoverageCompetenceOpen(workspaceId, '2026-09-30'), (error) => error.code === 'PTRP_COMPETENCE_CLOSED');
    await assertCoverageCompetenceOpen(workspaceId, '2026-10-01');
    await closure.update({ status: 'open' });
    await assertCoverageCompetenceOpen(workspaceId, '2026-09-15');
  } finally {
    await closure.delete();
  }
});
