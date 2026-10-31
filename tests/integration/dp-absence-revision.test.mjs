import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { ABSENCE_OPERATIONAL_COVERAGE_HASH, operationalDayRefs } = await import('../../src/features/dp/absences/operational/occupancy-guard.server.ts');
const { prepareOperationalAbsence, activateOperationalAbsence, reverseOperationalAbsence } = await import('../../src/features/dp/absences/operational/protocol.server.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');
const { listAbsenceCoverageCandidates, decideAbsenceCoverage } = await import('../../src/features/dp/absences/coverage/service.server.ts');

test('ausência ativa remove turno apontado por overlay e cancelamento não o restaura', async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `absence-rev-${suffix}`;
  const uid = `${workspaceId}-person`;
  const reviewer = `${workspaceId}-reviewer`;
  const substituteUid = `${workspaceId}-substitute`;
  const journeyId = `${workspaceId}-journey`;
  const definitionId = `${workspaceId}-definition`;
  const unitId = `${workspaceId}-unit`;
  const requestId = `${workspaceId}-request`;
  const date = '2027-12-14';
  const [year, month] = date.split('-').map(Number);
  const schedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-schedule`);
  const legacySchedule = dbAdmin.collection('dp_schedules').doc(`${workspaceId}-legacy`);
  const legacyRequestId = `${workspaceId}-legacy-request`;
  const legacyDisplaced = dbAdmin.collection('dp_absenceDisplacedShifts').doc(`${workspaceId}-legacy-displaced`);
  const conflictRequestId = `${workspaceId}-conflict-request`;
  const conflictDisplaced = dbAdmin.collection('dp_absenceDisplacedShifts').doc(`${workspaceId}-conflict-displaced`);
  const legacyCoverageShiftId = `absence-coverage-${legacyDisplaced.id.slice(0, 40)}`;
  const revisionId = 'rev-1';
  const shift = { id: 'work', scheduleId: schedule.id, userId: uid, unitId, date,
    type: 'work', startTime: '09:00', endTime: '17:00', shiftDefinitionId: definitionId };
  const index = dbAdmin.collection('dp_personScheduleIndex').doc(createHash('sha256').update(`${uid}:2027-12`).digest('hex'));
  const coverageId = createHash('sha256').update(`${workspaceId}:schedules:unit:${unitId}`).digest('hex');
  const epoch = randomUUID();
  const intent = { requestId, workspaceId, beneficiaryUid: uid, unitId, expectedVersion: 1, revision: 1,
    operationId: randomUUID(), actionHash: 'hash', actorUid: reviewer, fenceId: randomUUID(),
    status: 'prepared', blocksSchedule: true,
    segments: [{ date, fromMinute: 0, toMinute: 1440 }], createdAt: new Date().toISOString() };
  try {
    await Promise.all([
      dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).set({ workspaceId,
        state: 'ready', scopeKind: 'workspace_all', scopeHash: 'a'.repeat(64), bootstrapComplete: true,
        coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', coverageHash: ABSENCE_OPERATIONAL_COVERAGE_HASH, epoch }),
      dbAdmin.collection('dp_responsibilityCoverages').doc(coverageId).set({ id: coverageId, workspaceId,
        activity: 'schedules', scope: { kind: 'unit', id: unitId }, scopeKey: `unit:${unitId}`,
        levels: [{ kind: 'people', personIds: [reviewer] }], state: 'active', version: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade operacional teste' }),
      dbAdmin.collection('users').doc(substituteUid).set({ isActive: true, username: 'Substituta',
        unitId, unitIds: [unitId], employerUnitId: unitId, employerCnpj: '14276603000125',
        employmentRelationshipType: 'clt' }),
      dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1,
        status: 'published', name: 'Jornada teste', validFrom: '2026-01-01', weeklyMinutes: 2640,
        cycleLengthDays: 7, days: [{ dayIndex: 0, plannedMinutes: 440, isRestDay: false }],
        applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
      dbAdmin.collection('dp_shiftDefinitions').doc(definitionId).set({ name: 'Turno', startTime: '09:00',
        endTime: '17:00', journeyIds: [journeyId] }),
      schedule.set({ workspaceId, year, month, unitId, activeRevisionId: revisionId,
        publicationStatus: 'published', publicationVersion: 1, operationalVersion: 0,
        shiftCount: 1, goalEligibilityVersion: 0, journeyValidationVersion: 0 }),
      schedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: schedule.id, shiftCount: 1 }),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc('work').set(shift),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(uid).set({ shifts: [shift] }),
      schedule.collection('shifts').doc('work').set(shift),
      index.set({ userId: uid, competence: '2027-12', scheduleIds: [schedule.id] }),
      hrDbAdmin.collection('dp_absenceRequests').doc(requestId).set({ status: 'approved', version: 2 }),
    ]);
    const prepared = await prepareOperationalAbsence(intent);
    assert.equal(prepared.prepared, true);
    await activateOperationalAbsence(intent);
    assert.deepEqual((await readOfficialScheduleShifts({ scheduleId: schedule.id, userId: uid })).shifts, []);
    assert.equal((await schedule.collection('shifts').doc('work').get()).exists, true);
    assert.equal((await schedule.get()).get('operationalVersion'), 1);
    const displaced = await dbAdmin.collection('dp_absenceDisplacedShifts').where('requestId', '==', requestId).get();
    assert.equal(displaced.size, 1);
    assert.equal(displaced.docs[0].get('originalPath'), `dp_schedules/${schedule.id}/shifts/work`);
    const actor = { workspace_id: workspaceId, isDefaultAdmin: true, decoded: { uid: reviewer },
      userDoc: { username: 'DP' }, permissions: { dp: { schedules: { edit: true } } } };
    const candidates = await listAbsenceCoverageCandidates(actor, requestId, { displacedId: displaced.docs[0].id });
    assert.ok(candidates.candidates.some((candidate) => candidate.uid === substituteUid && candidate.eligible));
    const operationId = randomUUID();
    const decisionInput = { displacedId: displaced.docs[0].id, mode: 'cover', substituteUid, operationId };
    const revisionNotification = dbAdmin.collection('userNotifications').doc(createHash('sha256')
      .update(`absence-coverage:${displaced.docs[0].id}:${substituteUid}`).digest('hex'));
    await revisionNotification.set({ workspaceId, occupied: true });
    await assert.rejects(decideAbsenceCoverage(actor, requestId, decisionInput));
    assert.equal((await displaced.docs[0].ref.get()).get('coverage'), undefined);
    assert.equal((await schedule.get()).get('operationalVersion'), 1);
    await revisionNotification.delete();
    await decideAbsenceCoverage(actor, requestId, decisionInput);
    await decideAbsenceCoverage(actor, requestId, decisionInput);
    const coverageShiftId = `absence-coverage-${displaced.docs[0].id.slice(0, 40)}`;
    const effective = (await readOfficialScheduleShifts({ scheduleId: schedule.id, userId: substituteUid })).shifts;
    assert.equal(effective.length, 1);
    assert.equal(effective[0].id, coverageShiftId);
    assert.equal((await schedule.collection('shifts').doc(coverageShiftId).get()).exists, false);
    assert.equal((await displaced.docs[0].ref.get()).get('coverage.substituteUid'), substituteUid);
    await conflictDisplaced.set({ workspaceId, requestId: conflictRequestId, beneficiaryUid: uid, unitId,
      officialRevisionId: revisionId,
      scheduleId: schedule.id, originalPath: `dp_schedules/${schedule.id}/shifts/conflict-original`,
      shiftId: 'conflict-original', shift: { userId: uid, unitId, date, type: 'work',
        startTime: '09:00', endTime: '17:00', shiftDefinitionId: definitionId } });
    const conflictInput = { displacedId: conflictDisplaced.id, mode: 'cover', substituteUid, operationId: randomUUID() };
    await assert.rejects(decideAbsenceCoverage(actor, conflictRequestId, conflictInput),
      { code: 'DP_ABSENCE_COVERAGE_NOT_ELIGIBLE' });
    assert.equal((await conflictDisplaced.get()).get('coverage'), undefined);
    await Promise.all([
      legacySchedule.set({ workspaceId, year, month, unitId, locked: false, shiftCount: 0,
        goalEligibilityVersion: 0, journeyValidationVersion: 0 }),
      legacyDisplaced.set({ workspaceId, requestId: legacyRequestId, beneficiaryUid: uid, unitId,
        scheduleId: legacySchedule.id, originalPath: `dp_schedules/${legacySchedule.id}/shifts/original`,
        shiftId: 'original', shift: { userId: uid, unitId, date: '2027-12-16', type: 'work',
          startTime: '09:00', endTime: '17:00', shiftDefinitionId: definitionId } }),
    ]);
    const legacyInput = { displacedId: legacyDisplaced.id, mode: 'cover', substituteUid, operationId: randomUUID() };
    const legacyNotification = dbAdmin.collection('userNotifications').doc(createHash('sha256')
      .update(`absence-coverage:${legacyDisplaced.id}:${substituteUid}`).digest('hex'));
    await legacyNotification.set({ workspaceId, occupied: true });
    await assert.rejects(decideAbsenceCoverage(actor, legacyRequestId, legacyInput));
    assert.equal((await legacyDisplaced.get()).get('coverage'), undefined);
    assert.equal((await legacySchedule.collection('shifts').doc(legacyCoverageShiftId).get()).exists, false);
    await legacyNotification.delete();
    await decideAbsenceCoverage(actor, legacyRequestId, legacyInput);
    assert.equal((await legacySchedule.collection('shifts').doc(legacyCoverageShiftId).get()).get('userId'), substituteUid);
    assert.equal((await legacyDisplaced.get()).get('coverage.substituteUid'), substituteUid);
    assert.equal((await dbAdmin.collection('dp_responsibilityTasks').doc(`${requestId}_schedule_recomposition`).get()).exists, true);
    await reverseOperationalAbsence(intent);
    assert.deepEqual((await readOfficialScheduleShifts({ scheduleId: schedule.id, userId: uid })).shifts, []);
  } finally {
    const refs = operationalDayRefs(workspaceId, uid, date);
    const displaced = await dbAdmin.collection('dp_absenceDisplacedShifts').where('requestId', '==', requestId).get();
    const notifications = await dbAdmin.collection('userNotifications').where('workspaceId', '==', workspaceId).get();
    const logs = await dbAdmin.collection('actionLogs').where('workspace_id', '==', workspaceId).get();
    const references = await dbAdmin.collection('dp_shiftReferenceHistory').where('workspaceId', '==', workspaceId).get();
    await Promise.all([...displaced.docs, ...notifications.docs, ...logs.docs, ...references.docs].map((doc) => doc.ref.delete()));
    await Promise.all([
      refs.marker.delete(), refs.clock.delete(),
      dbAdmin.collection('dp_absenceOperationalFences').doc(requestId).delete(),
      dbAdmin.collection('dp_absenceOperationalAvailability').doc(requestId).delete(),
      dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).delete(),
      dbAdmin.collection('dp_responsibilityCoverages').doc(coverageId).delete(),
      dbAdmin.collection('dp_units').doc(unitId).delete(),
      dbAdmin.collection('users').doc(substituteUid).delete(),
      dbAdmin.collection('dp_journeys').doc(journeyId).delete(),
      dbAdmin.collection('dp_shiftDefinitions').doc(definitionId).delete(),
      dbAdmin.collection('dp_responsibilityTasks').doc(`${requestId}_schedule_recomposition`).delete(),
      dbAdmin.collection('dp_responsibilityTasks').doc(`${requestId}_cancellation_review`).delete(),
      dbAdmin.collection('dp_responsibilityTaskAudit').doc(`${requestId}_schedule_recomposition_1`).delete(),
      dbAdmin.collection('dp_responsibilityTaskAudit').doc(`${requestId}_cancellation_review_1`).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc('work').delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('people').doc(uid).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('people').doc(substituteUid).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc(`absence-coverage-${createHash('sha256').update(`${requestId}:dp_schedules/${schedule.id}/shifts/work`).digest('hex').slice(0, 40)}`).delete(),
      dbAdmin.collection('dp_personScheduleIndex').doc(createHash('sha256').update(`${substituteUid}:2027-12`).digest('hex')).delete(),
      dbAdmin.collection('dp_personAgendaClocks').doc(createHash('sha256').update(`${workspaceId}:${substituteUid}`).digest('hex')).delete(),
      schedule.collection('shifts').doc('work').delete(),
      legacySchedule.collection('shifts').doc(legacyCoverageShiftId).delete(),
      legacySchedule.delete(), legacyDisplaced.delete(),
      conflictDisplaced.delete(),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc('work').delete(),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(uid).delete(),
      schedule.collection('revisions').doc(revisionId).delete(), schedule.delete(), index.delete(),
      hrDbAdmin.collection('dp_absenceRequests').doc(requestId).delete(),
    ]);
  }
});
