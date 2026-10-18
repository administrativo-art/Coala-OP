import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { saveWorkShift } = await import('../../src/features/dp/shifts/service.server.ts');
const { applyWorkShiftBulkChange } = await import('../../src/features/dp/shifts/bulk-service.server.ts');

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
