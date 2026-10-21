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
