import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { defaultGuestPermissions } = await import('../../src/types/index.ts');
const { createShiftSwap, decideShiftSwap, listOwnShiftSwaps, listShiftSwapOptions } = await import('../../src/features/dp/shift-swaps/contract.server.ts');

const plusDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('troca de turno usa contrato central, exige o aceite da outra pessoa e preserva a escala na recusa', async () => {
  const prefix = `shift-swap-${randomUUID().slice(0, 8)}`;
  const workspaceId = `${prefix}-workspace`;
  const requesterUid = `${prefix}-requester`;
  const targetUid = `${prefix}-target`;
  const outsiderUid = `${prefix}-outsider`;
  const unitId = `${prefix}-unit`;
  const journeyId = `${prefix}-journey`;
  const morningId = `${prefix}-morning`;
  const afternoonId = `${prefix}-afternoon`;
  const firstDate = plusDays(10);
  const secondDate = plusDays(11);
  const [year, month] = firstDate.split('-').map(Number);
  const scheduleId = `${prefix}-schedule`;
  const schedule = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const shifts = {
    offered: schedule.collection('shifts').doc('offered'),
    requested: schedule.collection('shifts').doc('requested'),
    rejectOffered: schedule.collection('shifts').doc('reject-offered'),
    rejectRequested: schedule.collection('shifts').doc('reject-requested'),
  };
  const permissions = structuredClone(defaultGuestPermissions);
  permissions.dashboard.collaborator = true;
  const actor = (uid, name) => ({ decoded: { uid, email: `${uid}@example.test`, auth_time: 1_795_000_000, firebase: { sign_in_provider: 'password' } },
    userDoc: { id: uid, username: name, unitId, unitIds: [unitId] }, profileId: null, permissions,
    isDefaultAdmin: false, workspace_id: workspaceId });
  const requester = actor(requesterUid, 'Ana');
  const target = actor(targetUid, 'Bia');
  const outsider = actor(outsiderUid, 'Clara');
  const evidence = (context, operationId) => ({ authenticatedUid: context.decoded.uid, authenticatedEmail: context.decoded.email,
    actorName: context.userDoc.username, authTime: '2026-10-21T12:00:00.000Z', signInProvider: 'password',
    ipAddress: '127.0.0.1', userAgent: 'integration-test', operationId });
  const shift = (date, userId, userName, startTime, endTime, shiftDefinitionId) => ({ scheduleId, unitId, date, userId, userName,
    type: 'work', startTime, endTime, shiftDefinitionId, referenceRevisionId: null });

  try {
    await Promise.all([
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade piloto', isArchived: false, cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
      dbAdmin.collection('users').doc(requesterUid).set({ isActive: true, username: 'Ana', unitId, unitIds: [unitId], employerUnitId: unitId, employerCnpj: '14276603000125', employmentRelationshipType: 'clt' }),
      dbAdmin.collection('users').doc(targetUid).set({ isActive: true, username: 'Bia', unitId, unitIds: [unitId], employerUnitId: unitId, employerCnpj: '14276603000125', employmentRelationshipType: 'clt' }),
      dbAdmin.collection('users').doc(outsiderUid).set({ isActive: true, username: 'Clara', unitId, unitIds: [unitId] }),
      dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published', name: 'Jornada piloto', validFrom: '2026-01-01',
        weeklyMinutes: 2640, cycleLengthDays: 7, days: [{ dayIndex: 0, plannedMinutes: 440, isRestDay: false }],
        applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
      dbAdmin.collection('dp_shiftDefinitions').doc(morningId).set({ name: 'Manhã', startTime: '08:00', endTime: '16:00', journeyIds: [journeyId] }),
      dbAdmin.collection('dp_shiftDefinitions').doc(afternoonId).set({ name: 'Tarde', startTime: '14:00', endTime: '22:00', journeyIds: [journeyId] }),
      schedule.set({ year, month, unitId, locked: true, createdAt: new Date(), goalEligibilityVersion: 0, journeyValidationVersion: 0 }),
      shifts.offered.set(shift(firstDate, requesterUid, 'Ana', '08:00', '16:00', morningId)),
      shifts.requested.set(shift(firstDate, targetUid, 'Bia', '14:00', '22:00', afternoonId)),
      shifts.rejectOffered.set(shift(secondDate, requesterUid, 'Ana', '08:00', '16:00', morningId)),
      shifts.rejectRequested.set(shift(secondDate, targetUid, 'Bia', '14:00', '22:00', afternoonId)),
    ]);

    const options = await listShiftSwapOptions(requester);
    assert.ok(options.ownShifts.some((item) => item.shiftId === shifts.offered.id));
    assert.ok(options.candidateShifts.some((item) => item.shiftId === shifts.requested.id && item.occupantName === 'Bia'));

    const createOperation = randomUUID();
    const created = await createShiftSwap(requester, { scheduleId, offeredShiftId: shifts.offered.id, requestedShiftId: shifts.requested.id,
      operationId: createOperation, reason: 'Preciso inverter este turno.' }, evidence(requester, createOperation));
    assert.equal(created.request.status, 'pending');
    assert.deepEqual(created.request.participantUids, [requesterUid, targetUid]);
    assert.equal(created.request.events[0].evidence.authenticatedUid, requesterUid);
    assert.equal(created.request.events[0].evidence.operationId, createOperation);
    assert.equal((await listOwnShiftSwaps(target)).some((item) => item.id === created.request.id), true);
    assert.equal((await createShiftSwap(requester, { scheduleId, offeredShiftId: shifts.offered.id, requestedShiftId: shifts.requested.id,
      operationId: createOperation, reason: 'Preciso inverter este turno.' }, evidence(requester, createOperation))).request.id, created.request.id);
    await assert.rejects(createShiftSwap(requester, { scheduleId, offeredShiftId: shifts.offered.id, requestedShiftId: shifts.requested.id,
      operationId: createOperation, reason: 'Conteúdo diferente na mesma tentativa.' }, evidence(requester, createOperation)), { code: 'SHIFT_SWAP_OPERATION_CONFLICT' });

    const conflictOperation = randomUUID();
    await assert.rejects(createShiftSwap(target, { scheduleId, offeredShiftId: shifts.requested.id, requestedShiftId: shifts.offered.id,
      operationId: conflictOperation }, evidence(target, conflictOperation)), { code: 'SHIFT_SWAP_ALREADY_PENDING' });
    const outsiderOperation = randomUUID();
    await assert.rejects(decideShiftSwap(outsider, created.request.id, { action: 'accept', expectedVersion: 1, operationId: outsiderOperation },
      evidence(outsider, outsiderOperation)), { code: 'SHIFT_SWAP_TARGET_DECISION_REQUIRED' });

    const acceptOperation = randomUUID();
    const accepted = await decideShiftSwap(target, created.request.id, { action: 'accept', expectedVersion: 1, operationId: acceptOperation }, evidence(target, acceptOperation));
    assert.equal(accepted.request.status, 'accepted');
    assert.equal(accepted.request.events.at(-1).evidence.authenticatedUid, targetUid);
    assert.equal((await decideShiftSwap(target, created.request.id, { action: 'accept', expectedVersion: 1, operationId: acceptOperation },
      evidence(target, acceptOperation))).request.status, 'accepted');
    await assert.rejects(decideShiftSwap(target, created.request.id, { action: 'cancel', expectedVersion: 1, operationId: acceptOperation },
      evidence(target, acceptOperation)), { code: 'SHIFT_SWAP_OPERATION_CONFLICT' });
    const [acceptedOffered, acceptedRequested] = await Promise.all([shifts.offered.get(), shifts.requested.get()]);
    assert.deepEqual([acceptedOffered.get('userId'), acceptedOffered.get('startTime'), acceptedOffered.get('endTime')], [targetUid, '08:00', '16:00']);
    assert.deepEqual([acceptedRequested.get('userId'), acceptedRequested.get('startTime'), acceptedRequested.get('endTime')], [requesterUid, '14:00', '22:00']);
    assert.match(acceptedOffered.get('referenceRevisionId'), /.+/);
    assert.match(acceptedRequested.get('referenceRevisionId'), /.+/);
    const updatedSchedule = await schedule.get();
    assert.deepEqual([updatedSchedule.get('locked'), updatedSchedule.get('goalEligibilityVersion'), updatedSchedule.get('journeyValidationVersion')], [true, 1, 1]);

    const rejectCreateOperation = randomUUID();
    const rejectProposal = await createShiftSwap(requester, { scheduleId, offeredShiftId: shifts.rejectOffered.id,
      requestedShiftId: shifts.rejectRequested.id, operationId: rejectCreateOperation }, evidence(requester, rejectCreateOperation));
    const rejectOperation = randomUUID();
    const rejected = await decideShiftSwap(target, rejectProposal.request.id, { action: 'reject', expectedVersion: 1,
      operationId: rejectOperation, reason: 'Não consigo trocar neste dia.' }, evidence(target, rejectOperation));
    assert.equal(rejected.request.status, 'rejected');
    const [rejectedOffered, rejectedRequested] = await Promise.all([shifts.rejectOffered.get(), shifts.rejectRequested.get()]);
    assert.deepEqual([rejectedOffered.get('userId'), rejectedRequested.get('userId')], [requesterUid, targetUid]);
  } finally {
    const requestDocs = await dbAdmin.collection('dp_shiftSwapRequests').where('workspaceId', '==', workspaceId).limit(20).get();
    const historyDocs = await dbAdmin.collection('dp_shiftReferenceHistory').where('scheduleId', '==', scheduleId).limit(20).get();
    const notificationDocs = await dbAdmin.collection('userNotifications').where('workspaceId', '==', workspaceId).limit(20).get();
    const logDocs = await dbAdmin.collection('actionLogs').where('workspace_id', '==', workspaceId).limit(20).get();
    await Promise.all([...requestDocs.docs, ...historyDocs.docs, ...notificationDocs.docs, ...logDocs.docs].map((doc) => doc.ref.delete()));
    await Promise.all(Object.values(shifts).map((ref) => ref.delete()));
    await Promise.all([schedule, dbAdmin.collection('dp_units').doc(unitId), dbAdmin.collection('dp_journeys').doc(journeyId),
      dbAdmin.collection('dp_shiftDefinitions').doc(morningId), dbAdmin.collection('dp_shiftDefinitions').doc(afternoonId),
      dbAdmin.collection('users').doc(requesterUid), dbAdmin.collection('users').doc(targetUid), dbAdmin.collection('users').doc(outsiderUid)].map((ref) => ref.delete()));
  }
});

test('troca em revisão ativa aplica overlay atômico e torna edição de rascunho conflitante', async () => {
  const { createHash } = await import('node:crypto');
  const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');
  const { scheduleShiftFingerprint, mergeScheduleDraft } = await import('../../src/lib/dp-schedule-publication.ts');
  const prefix = `shift-swap-revision-${randomUUID().slice(0, 8)}`;
  const workspaceId = `${prefix}-workspace`;
  const requesterUid = `${prefix}-requester`;
  const targetUid = `${prefix}-target`;
  const unitId = `${prefix}-unit`;
  const journeyId = `${prefix}-journey`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  const revisionId = 'rev-1';
  const otherSchedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-other-schedule`);
  const date = plusDays(12);
  const [year, month] = date.split('-').map(Number);
  const competence = date.slice(0, 7);
  const offered = { id: 'offered', scheduleId: schedule.id, unitId, date, userId: requesterUid, userName: 'Ana',
    type: 'work', startTime: '08:00', endTime: '16:00', referenceRevisionId: null };
  const requested = { id: 'requested', scheduleId: schedule.id, unitId, date, userId: targetUid, userName: 'Bia',
    type: 'work', startTime: '14:00', endTime: '22:00', referenceRevisionId: null };
  const permissions = structuredClone(defaultGuestPermissions);
  permissions.dashboard.collaborator = true;
  const actor = (uid, name) => ({ decoded: { uid, email: `${uid}@example.test` },
    userDoc: { id: uid, username: name, unitId, unitIds: [unitId] }, profileId: null,
    permissions, isDefaultAdmin: false, workspace_id: workspaceId });
  const requester = actor(requesterUid, 'Ana');
  const target = actor(targetUid, 'Bia');
  const evidence = (context, operationId) => ({ authenticatedUid: context.decoded.uid,
    authenticatedEmail: context.decoded.email, actorName: context.userDoc.username,
    authTime: '2026-10-21T12:00:00.000Z', signInProvider: 'password', ipAddress: '127.0.0.1',
    userAgent: 'integration-test', operationId });
  const indexRef = (uid) => dbAdmin.collection('dp_personScheduleIndex').doc(
    createHash('sha256').update(`${uid}:${competence}`).digest('hex'));
  try {
    await Promise.all([
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unidade piloto', isArchived: false }),
      dbAdmin.collection('users').doc(requesterUid).set({ isActive: true, username: 'Ana', unitId, unitIds: [unitId] }),
      dbAdmin.collection('users').doc(targetUid).set({ isActive: true, username: 'Bia', unitId, unitIds: [unitId] }),
      dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published',
        name: 'Jornada piloto', validFrom: '2026-01-01', weeklyMinutes: 2640, cycleLengthDays: 7,
        days: [{ dayIndex: 0, plannedMinutes: 440, isRestDay: false }], applicability: { scope: { kind: 'company' } },
        allowedShiftDefinitionIds: [] }),
      schedule.set({ year, month, unitId, createdAt: new Date(), publicationStatus: 'published', publicationVersion: 1,
        activeRevisionId: revisionId, operationalVersion: 0, goalEligibilityVersion: 0, journeyValidationVersion: 0, shiftCount: 2 }),
      schedule.collection('revisions').doc(revisionId).set({ scheduleId: schedule.id, status: 'ready', shiftCount: 2 }),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc('offered').set(offered),
      schedule.collection('revisions').doc(revisionId).collection('entries').doc('requested').set(requested),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(requesterUid).set({ shifts: [offered] }),
      schedule.collection('revisions').doc(revisionId).collection('people').doc(targetUid).set({ shifts: [requested] }),
      indexRef(requesterUid).set({ userId: requesterUid, competence, scheduleIds: [schedule.id] }),
      indexRef(targetUid).set({ userId: targetUid, competence, scheduleIds: [schedule.id] }),
      schedule.collection('shifts').doc('offered').set({ ...offered, startTime: '06:00' }),
      schedule.collection('shifts').doc('requested').set({ ...requested, startTime: '12:00' }),
    ]);
    const options = await listShiftSwapOptions(requester);
    assert.ok(options.ownShifts.some((item) => item.shiftId === offered.id && item.startTime === '08:00'));
    assert.ok(options.candidateShifts.some((item) => item.shiftId === requested.id && item.startTime === '14:00'));
    const operationId = randomUUID();
    const created = await createShiftSwap(requester, { scheduleId: schedule.id, offeredShiftId: offered.id,
      requestedShiftId: requested.id, operationId }, evidence(requester, operationId));
    const acceptId = randomUUID();
    const accepted = await decideShiftSwap(target, created.request.id,
      { action: 'accept', expectedVersion: 1, operationId: acceptId }, evidence(target, acceptId));
    assert.equal(accepted.request.status, 'accepted');
    const official = await readOfficialScheduleShifts({ scheduleId: schedule.id });
    const byId = new Map(official.shifts.map((shift) => [shift.id, shift]));
    assert.equal(byId.get('offered').userId, targetUid);
    assert.equal(byId.get('requested').userId, requesterUid);
    assert.equal((await schedule.collection('shifts').doc('offered').get()).get('userId'), requesterUid);
    assert.equal((await schedule.get()).get('operationalVersion'), 1);
    const draft = new Map([['offered', { baseFingerprint: scheduleShiftFingerprint(offered), value: offered }]]);
    assert.deepEqual(mergeScheduleDraft(new Map([['offered', byId.get('offered')]]), draft).conflicts, ['offered']);
    const rejectId = randomUUID();
    const rejectedProposal = await createShiftSwap(requester, { scheduleId: schedule.id, offeredShiftId: requested.id,
      requestedShiftId: offered.id, operationId: rejectId }, evidence(requester, rejectId));
    const rejectDecisionId = randomUUID();
    const rejected = await decideShiftSwap(target, rejectedProposal.request.id,
      { action: 'reject', expectedVersion: 1, operationId: rejectDecisionId, reason: 'Não posso trocar.' },
      evidence(target, rejectDecisionId));
    assert.equal(rejected.request.status, 'rejected');
    assert.equal((await schedule.get()).get('operationalVersion'), 1);
    const staleId = randomUUID();
    const staleProposal = await createShiftSwap(requester, { scheduleId: schedule.id, offeredShiftId: requested.id,
      requestedShiftId: offered.id, operationId: staleId }, evidence(requester, staleId));
    const { applyActiveRevisionOperationalChanges } = await import('../../src/features/dp/schedules/operational-overlay.server.ts');
    await dbAdmin.runTransaction(async (tx) => {
      const snapshot = await tx.get(schedule);
      const previous = byId.get('requested');
      await applyActiveRevisionOperationalChanges({ tx, schedule: snapshot, workspaceId, actorId: 'operational-event', reason: 'test_change',
        changes: [{ shiftId: 'requested', previous, next: { ...previous, startTime: '15:00' } }] });
    });
    const staleDecisionId = randomUUID();
    const stale = await decideShiftSwap(target, staleProposal.request.id,
      { action: 'accept', expectedVersion: 1, operationId: staleDecisionId }, evidence(target, staleDecisionId));
    assert.equal(stale.request.status, 'stale');
    assert.equal((await schedule.get()).get('operationalVersion'), 2);
    const extraShift = { id: 'extra', scheduleId: otherSchedule.id, unitId, date, userId: requesterUid,
      type: 'work', startTime: '18:00', endTime: '22:00' };
    await Promise.all([
      otherSchedule.set({ year, month, unitId, activeRevisionId: revisionId,
        publicationStatus: 'published', publicationVersion: 1, operationalVersion: 0 }),
      otherSchedule.collection('revisions').doc(revisionId).set({ status: 'ready', scheduleId: otherSchedule.id }),
      otherSchedule.collection('revisions').doc(revisionId).collection('entries').doc('extra').set(extraShift),
      otherSchedule.collection('revisions').doc(revisionId).collection('people').doc(requesterUid).set({ shifts: [extraShift] }),
    ]);
    await indexRef(requesterUid).update({ scheduleIds: [schedule.id, otherSchedule.id] });
    const occupiedId = randomUUID();
    const occupiedProposal = await createShiftSwap(requester, { scheduleId: schedule.id, offeredShiftId: requested.id,
      requestedShiftId: offered.id, operationId: occupiedId }, evidence(requester, occupiedId));
    const occupiedDecisionId = randomUUID();
    await assert.rejects(decideShiftSwap(target, occupiedProposal.request.id,
      { action: 'accept', expectedVersion: 1, operationId: occupiedDecisionId }, evidence(target, occupiedDecisionId)),
    { code: 'SHIFT_SWAP_OTHER_OCCUPANCY' });
  } finally {
    const requestDocs = await dbAdmin.collection('dp_shiftSwapRequests').where('workspaceId', '==', workspaceId).limit(20).get();
    const historyDocs = await dbAdmin.collection('dp_shiftReferenceHistory').where('scheduleId', '==', schedule.id).limit(20).get();
    const notificationDocs = await dbAdmin.collection('userNotifications').where('workspaceId', '==', workspaceId).limit(20).get();
    const logDocs = await dbAdmin.collection('actionLogs').where('workspace_id', '==', workspaceId).limit(20).get();
    await Promise.all([...requestDocs.docs, ...historyDocs.docs, ...notificationDocs.docs, ...logDocs.docs].map((doc) => doc.ref.delete()));
    await Promise.all(['offered', 'requested'].flatMap((id) => [
      schedule.collection('shifts').doc(id).delete(), schedule.collection('revisions').doc(revisionId).collection('entries').doc(id).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('entries').doc(id).delete()]));
    await Promise.all([requesterUid, targetUid].flatMap((uid) => [
      schedule.collection('revisions').doc(revisionId).collection('people').doc(uid).delete(),
      schedule.collection('operationalOverlays').doc(revisionId).collection('people').doc(uid).delete(),
      indexRef(uid).delete(), dbAdmin.collection('users').doc(uid).delete()]));
    await Promise.all([schedule.collection('revisions').doc(revisionId).delete(), schedule.delete(),
      otherSchedule.collection('revisions').doc(revisionId).collection('entries').doc('extra').delete(),
      otherSchedule.collection('revisions').doc(revisionId).collection('people').doc(requesterUid).delete(),
      otherSchedule.collection('revisions').doc(revisionId).delete(), otherSchedule.delete(),
      dbAdmin.collection('dp_units').doc(unitId).delete(), dbAdmin.collection('dp_journeys').doc(journeyId).delete()]);
  }
});
