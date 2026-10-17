import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

const projectId = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId });
enableServerOnlyTestImports(projectId);
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { WORKSPACE_ID } = await import('../../src/lib/workspace.ts');
const { belemCivilDate } = await import('../../src/features/dp/absences/requests/core.ts');
const { operationalDayRefs, ABSENCE_OPERATIONAL_COVERAGE_HASH, guardOccupancyWrite,
  operationalGuardRequested, shiftOccupancySlices, vacationOccupancySlices } = await import('../../src/features/dp/absences/operational/occupancy-guard.server.ts');
const { bootstrapAbsenceOperationalReadiness, auditAbsenceOperationalSources } = await import('../../src/features/dp/absences/operational/bootstrap.server.ts');
const { applyUserTerminationEffects, TerminationOccupancyGuardPending } =
  await import('../../functions/src/user-termination-effects.ts');
const { activateOperationalAbsence, beginOperationalIntent, prepareOperationalAbsence,
  markOperationalIntentPrepared, requestOperationalAbort, abortOperationalIntent,
  operationalIntentRef } = await import('../../src/features/dp/absences/operational/protocol.server.ts');
const collectionRoute = await import('../../src/app/api/collaborator/absence-requests/route.ts');
const itemRoute = await import('../../src/app/api/collaborator/absence-requests/[requestId]/route.ts');
const reconcileRoute = await import('../../src/app/api/dp/absence-operational/[requestId]/reconcile/route.ts');
const natashaAvailabilityRoute = await import('../../src/app/api/dp/natasha/availability/route.ts');
const scheduleAbsencesRoute = await import('../../src/app/api/dp/schedules/[scheduleId]/absences/route.ts');
const responsibilityTaskRoute = await import('../../src/app/api/dp/responsibility-tasks/[taskId]/route.ts');

const suffix = randomUUID().slice(0, 8);
const personUid = `absence-op-person-${suffix}`;
const reviewerUid = `absence-op-review-${suffix}`;
const adminUid = `absence-op-admin-${suffix}`;
const unitId = `absence-op-unit-${suffix}`;
const typeId = `absence-op-type-${suffix}`;
const password = 'absence-op-123';
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const startDate = addDays(belemCivilDate(new Date()), 5);
const preview = { absenceTypeId: typeId, startDate, endDate: startDate, unit: 'day' };
const workspaceId = WORKSPACE_ID;
const pathname = '/api/collaborator/absence-requests';
const call = (path, method, token, body) => new NextRequest(`http://localhost${path}`, { method,
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}) });
const context = (requestId) => ({ params: Promise.resolve(requestId ? { requestId } : {}) });
async function signIn(uid) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? ''));
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${uid}@example.test`, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}
async function seed() {
  for (const [uid, profileId] of [[personUid, 'absence-op-person-profile'], [reviewerUid, 'absence-op-review-profile'],
    [adminUid, 'absence-op-admin-profile']]) {
    await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
    await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
  }
  const batch = dbAdmin.batch();
  batch.set(dbAdmin.collection('profiles').doc('absence-op-person-profile'), { permissions: { dashboard: { collaborator: true } } });
  batch.set(dbAdmin.collection('profiles').doc('absence-op-review-profile'), {
    permissions: { dashboard: { collaborator: false }, dp: { requests: { review: true, view: true }, schedules: { view: true, edit: true } } },
  });
  batch.set(dbAdmin.collection('profiles').doc('absence-op-admin-profile'), { isDefaultAdmin: true, permissions: {} });
  for (const [uid, profileId] of [[personUid, 'absence-op-person-profile'], [reviewerUid, 'absence-op-review-profile'],
    [adminUid, 'absence-op-admin-profile']]) {
    batch.set(dbAdmin.collection('users').doc(uid), { username: uid, email: `${uid}@example.test`, profileId,
      isActive: true, sessionVersion: 0, employmentRelationshipType: 'clt', unitId, unitIds: [unitId],
      profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
  batch.set(dbAdmin.collection('dp_units').doc(unitId), { name: 'Unidade operacional teste' });
  const coverageId = createHash('sha256').update(`${workspaceId}:schedules:unit:${unitId}`).digest('hex');
  batch.set(dbAdmin.collection('dp_responsibilityCoverages').doc(coverageId), {
    id: coverageId, workspaceId, activity: 'schedules', scope: { kind: 'unit', id: unitId },
    scopeKey: `unit:${unitId}`, levels: [{ kind: 'people', personIds: [reviewerUid] }],
    state: 'active', version: 1, createdAt: new Date().toISOString(), createdBy: adminUid,
    updatedAt: new Date().toISOString(), updatedBy: adminUid,
  });
  await batch.commit();
  await hrDbAdmin.collection('dp_absenceTypes').doc(typeId).set({ lineageId: typeId, version: 1,
    status: 'published', publishedAt: new Date(), name: 'Tipo operacional teste', color: 'blue',
    requestUnits: ['day'], initiatedBy: ['collaborator'], validFrom: '1900-01-01', validTo: '9999-12-31',
    workdayEffect: 'excused_absence', blocksSchedule: true, includeInAbsenteeism: true,
    policies: [{ id: 'policy', name: 'Regra', employmentRelationshipTypes: ['clt'],
      applicability: { scope: { kind: 'company' } }, calculation: 'calendar_days', attachment: 'not_required',
      approvalFlow: 'dp', approvalAssignments: { dp: [{ kind: 'people', personIds: [reviewerUid] }] },
      rejectionReasonRequired: true, allowFutureEdit: false, allowFutureCancel: true, maxUnitsPerPeriod: 5,
      limitPeriod: 'month' }],
  });
  await hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active').set({ state: 'ready', catalogDatabase: 'coala-rh' });
  await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).set({ workspaceId,
    state: 'ready', scopeKind: 'workspace_all', scopeHash: 'a'.repeat(64), bootstrapComplete: true,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31',
    coverageHash: ABSENCE_OPERATIONAL_COVERAGE_HASH, epoch: randomUUID() });
}

async function clearBootstrapFixtures() {
  const coalaCollections = ['dp_schedules', 'shifts', 'dp_vacations', 'dp_absenceOperationalAvailability',
    'dp_absenceOperationalFences', 'dp_absenceOperationalMarkers', 'dp_absenceOccupancyClocks',
    'dp_absenceOperationalReadiness', 'dp_absenceDisplacedShifts', 'dp_responsibilityTasks',
    'dp_responsibilityTaskAudit', 'dp_responsibilityCoverages', 'userNotifications'];
  const rhCollections = ['dp_absenceRequests', 'dp_absenceOccurrences', 'dp_absenceOperationalIntents',
    'dp_absenceOutbox', 'dp_absenceOperationalAudit', 'dp_absenceEvents', 'dp_absenceAudit',
    'dp_absenceIdempotency', 'dp_absenceDayReservations', 'dp_absenceBalances'];
  await Promise.all([
    ...coalaCollections.map((name) => dbAdmin.recursiveDelete(dbAdmin.collection(name))),
    ...rhCollections.map((name) => hrDbAdmin.recursiveDelete(hrDbAdmin.collection(name))),
  ]);
}

test('intent fenced: conflito, aborto tombstone, aprovação única, bloqueio de turno e reversão', async (t) => {
  const previousCatalog = process.env.DP_ABSENCE_CATALOG_DATABASE;
  const previousGuard = process.env.DP_ABSENCE_OPERATIONAL_GUARD;
  process.env.DP_ABSENCE_CATALOG_DATABASE = 'coala-rh';
  process.env.DP_ABSENCE_OPERATIONAL_GUARD = 'on';
  t.after(() => {
    if (previousCatalog === undefined) delete process.env.DP_ABSENCE_CATALOG_DATABASE;
    else process.env.DP_ABSENCE_CATALOG_DATABASE = previousCatalog;
    if (previousGuard === undefined) delete process.env.DP_ABSENCE_OPERATIONAL_GUARD;
    else process.env.DP_ABSENCE_OPERATIONAL_GUARD = previousGuard;
  });
  await clearBootstrapFixtures();
  t.after(async () => {
    await clearBootstrapFixtures();
    await Promise.allSettled([
      ...[personUid, reviewerUid, adminUid].map((uid) => authAdmin.deleteUser(uid)),
      ...[personUid, reviewerUid, adminUid].map((uid) => dbAdmin.collection('users').doc(uid).delete()),
      ...['absence-op-person-profile', 'absence-op-review-profile', 'absence-op-admin-profile']
        .map((id) => dbAdmin.collection('profiles').doc(id).delete()),
      dbAdmin.collection('dp_units').doc(unitId).delete(),
      hrDbAdmin.collection('dp_absenceTypes').doc(typeId).delete(),
      hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active').delete(),
    ]);
  });
  assert.ok(workspaceId);
  assert.equal(operationalGuardRequested(), true);
  assert.deepEqual(shiftOccupancySlices({ beneficiaryUid: personUid, date: startDate,
    startTime: '22:00', endTime: '06:00', addsOccupancy: true }).map((slice) => slice.date),
  [startDate, addDays(startDate, 1)]);
  assert.throws(() => shiftOccupancySlices({ beneficiaryUid: personUid, date: '2026-02-31',
    startTime: '09:00', endTime: '17:00', addsOccupancy: true }));
  assert.throws(() => vacationOccupancySlices({ beneficiaryUid: personUid,
    startDate, endDate: addDays(startDate, 180), addsOccupancy: true }));
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  assert.throws(() => operationalGuardRequested());
  process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  await seed();
  const transient = dbAdmin.collection('dp_schedules').doc(`absence-op-bootstrap-${suffix}`);
  await assert.rejects(bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true,
    betweenPasses: async () => {
      assert.equal((await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).get()).get('state'), 'bootstrapping');
      await assert.rejects(dbAdmin.runTransaction((tx) => guardOccupancyWrite(tx, workspaceId,
        shiftOccupancySlices({ beneficiaryUid: personUid, date: startDate,
          startTime: '09:00', endTime: '17:00', addsOccupancy: true }), 1)));
      await transient.set({ workspaceId, unitId });
    },
  }), /fontes mudaram/);
  assert.equal((await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).get()).get('state'), 'bootstrapping');
  await assert.rejects(applyUserTerminationEffects({ db: dbAdmin, hrDb: hrDbAdmin,
    checklistDb: dbAdmin, workspaceId, userId: personUid,
    user: { isActive: false, inactivationType: 'contract_termination', terminationDate: startDate } }),
  TerminationOccupancyGuardPending);
  assert.equal((await dbAdmin.collection('users').doc(personUid).get()).get('terminationEffectsVersion'), undefined);
  await transient.delete();
  await assert.rejects(bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true,
    betweenPasses: async () => {
      await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId)
        .update({ coverageThrough: '2099-12-31' });
    },
  }), /recibo alterado/);
  await assert.rejects(bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true,
    maxPerSource: 1, betweenPasses: async () => { await transient.set({ workspaceId, unitId }); },
  }), /fontes mudaram/);
  await transient.delete();
  assert.equal((await bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true })).state, 'ready');
  // Com recibo ready, o desligamento deixa de ficar pendente: remove o turno futuro e incrementa o relógio do dia.
  const terminatedUid = `absence-op-terminated-${suffix}`;
  const terminationSchedule = dbAdmin.collection('dp_schedules').doc(`absence-op-termination-${suffix}`);
  await terminationSchedule.set({ workspaceId, unitId, shiftCount: 1 });
  await terminationSchedule.collection('shifts').doc('future').set({ userId: terminatedUid, unitId,
    date: startDate, type: 'work', startTime: '22:00', endTime: '06:00' });
  await applyUserTerminationEffects({ db: dbAdmin, hrDb: hrDbAdmin, checklistDb: dbAdmin, workspaceId,
    userId: terminatedUid, user: { isActive: false, inactivationType: 'contract_termination',
      terminationDate: addDays(startDate, -1) } });
  assert.equal((await terminationSchedule.collection('shifts').doc('future').get()).exists, false);
  assert.equal((await terminationSchedule.get()).get('shiftCount'), 0);
  const readyEpoch = (await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).get()).get('epoch');
  for (const day of [startDate, addDays(startDate, 1)]) {
    const clock = await operationalDayRefs(workspaceId, terminatedUid, day).clock.get();
    assert.equal(clock.get('epoch'), readyEpoch);
    assert.equal(clock.get('version'), 1);
  }
  await dbAdmin.recursiveDelete(terminationSchedule);
  // Escala legada (sem unidade, unidade só no turno) é histórico aceito apenas se trancada e antes da janela.
  const legacySchedule = dbAdmin.collection('dp_schedules').doc(`absence-op-legacy-${suffix}`);
  await legacySchedule.set({ workspaceId, name: 'Dezembro de 2025', month: 12, year: 2025, locked: true });
  await legacySchedule.collection('shifts').doc('old').set({ userId: personUid, unitId: 'outra-unidade',
    date: '2025-12-10', type: null });
  const audit = (coverageFrom) => auditAbsenceOperationalSources({ workspaceId, coverageFrom, coverageThrough: '2099-12-31' });
  assert.equal((await audit('2026-05-01')).valid, true);
  assert.match((await audit('2025-01-01')).reason, /janela de cobertura/);
  await legacySchedule.update({ locked: false });
  assert.match((await audit('2026-05-01')).reason, /unidade da escala/);
  await dbAdmin.recursiveDelete(legacySchedule);
  const [person, reviewer, admin] = await Promise.all([signIn(personUid), signIn(reviewerUid), signIn(adminUid)]);
  const availabilityPath = `/api/dp/natasha/availability?period=${startDate.slice(0, 7)}&unit=${unitId}`;
  assert.equal((await natashaAvailabilityRoute.GET(call(availabilityPath, 'GET', reviewer), context())).status, 403);
  assert.equal((await natashaAvailabilityRoute.GET(call(`${availabilityPath}&workspaceId=forged`, 'GET', admin), context())).status, 400);
  const create = await collectionRoute.POST(call(pathname, 'POST', person,
    { idempotencyKey: randomUUID(), request: preview, preparationIds: [] }), context());
  assert.equal(create.status, 201);
  const id = (await create.json()).request.id;
  const path = `${pathname}/${id}`;
  const submitted = await itemRoute.PATCH(call(path, 'PATCH', person,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), context(id));
  assert.equal(submitted.status, 200);
  const pendingAvailability = await natashaAvailabilityRoute.GET(call(availabilityPath, 'GET', admin), context());
  assert.equal(pendingAvailability.status, 200);
  assert.equal((await pendingAvailability.json()).status, 'incomplete');

  const conflictRefs = operationalDayRefs(workspaceId, personUid, startDate);
  const conflictEpoch = (await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).get()).get('epoch');
  await Promise.all([
    conflictRefs.marker.set({ workspaceId, beneficiaryUid: personUid, date: startDate, epoch: conflictEpoch,
      entries: [{ requestId: `other-${suffix}`, requestVersion: 1, fenceId: `other-${suffix}`,
        fromMinute: 0, toMinute: 1440, blocksSchedule: true, state: 'active' }] }),
    conflictRefs.clock.set({ workspaceId, beneficiaryUid: personUid, date: startDate, epoch: conflictEpoch, version: 1 }),
  ]);
  const failedOperation = randomUUID();
  const conflict = await itemRoute.PATCH(call(path, 'PATCH', reviewer,
    { action: 'approve', expectedVersion: 2, operationId: failedOperation }), context(id));
  assert.equal(conflict.status, 409);
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(id).get()).get('operationalPending.operationId'), failedOperation);
  await dbAdmin.collection('profiles').doc('absence-op-review-profile').update({ 'permissions.dp.requests.review': false });
  assert.equal((await reconcileRoute.POST(call(`/api/dp/absence-operational/${id}/reconcile`, 'POST', reviewer,
    { expectedVersion: 2, action: 'abort_preparation' }), context(id))).status, 403);
  await dbAdmin.collection('profiles').doc('absence-op-review-profile').update({ 'permissions.dp.requests.review': true });
  const aborted = await reconcileRoute.POST(call(`/api/dp/absence-operational/${id}/reconcile`, 'POST', admin,
    { expectedVersion: 2, action: 'abort_preparation' }), context(id));
  assert.equal(aborted.status, 200);
  assert.equal((await hrDbAdmin.collection('dp_absenceOperationalAudit').doc(`${id}_3_abort`).get()).get('actorUid'), adminUid);
  const abortedRequest = await hrDbAdmin.collection('dp_absenceRequests').doc(id).get();
  assert.equal(abortedRequest.get('version'), 3);
  assert.equal(abortedRequest.get('history').at(-1).actorUid, adminUid);
  const oldIntent = (await operationalIntentRef(id, 2).get()).data();
  await assert.rejects(() => activateOperationalAbsence(oldIntent));
  await Promise.all([conflictRefs.marker.delete(), conflictRefs.clock.delete()]);

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(`absence-op-schedule-${suffix}`);
  const shiftRef = scheduleRef.collection('shifts').doc('work');
  await scheduleRef.set({ workspaceId, unitId, month: Number(startDate.slice(5, 7)), year: Number(startDate.slice(0, 4)),
    shiftCount: 1, goalEligibilityVersion: 0, journeyValidationVersion: 0 });
  await shiftRef.set({ userId: personUid, unitId, date: startDate, startTime: '09:00', endTime: '17:00', type: 'work' });

  const responses = await Promise.all([randomUUID(), randomUUID()].map((operationId) => itemRoute.PATCH(
    call(path, 'PATCH', reviewer, { action: 'approve', expectedVersion: 3, operationId }), context(id))));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const approved = (await hrDbAdmin.collection('dp_absenceRequests').doc(id).get()).data();
  assert.equal(approved.status, 'approved');
  assert.equal(approved.operationalFence.state, 'active');
  const projection = await dbAdmin.collection('dp_absenceOperationalAvailability').doc(id).get();
  assert.equal(projection.get('state'), 'active');
  assert.equal(projection.get('blocksSchedule'), true);
  assert.deepEqual(projection.get('monthKeys'), [startDate.slice(0, 7)]);
  assert.equal(projection.get('typeId'), undefined);
  assert.equal((await shiftRef.get()).exists, false);
  assert.equal((await scheduleRef.get()).get('shiftCount'), 0);
  const displaced = await dbAdmin.collection('dp_absenceDisplacedShifts').where('requestId', '==', id).get();
  assert.equal(displaced.size, 1);
  assert.equal(displaced.docs[0].get('originalPath'), shiftRef.path);
  const recomposition = await dbAdmin.collection('dp_responsibilityTasks').doc(`${id}_schedule_recomposition`).get();
  assert.equal(recomposition.get('status'), 'pending');
  assert.deepEqual(recomposition.get('assignedUserIds'), [reviewerUid]);
  const taskId = `${id}_schedule_recomposition`;
  const claimedTask = await responsibilityTaskRoute.PATCH(call(`/api/dp/responsibility-tasks/${taskId}`, 'PATCH', reviewer,
    { action: 'claim', expectedVersion: 1, operationId: randomUUID() }), { params: Promise.resolve({ taskId }) });
  assert.equal(claimedTask.status, 200);
  const lostClaim = await responsibilityTaskRoute.PATCH(call(`/api/dp/responsibility-tasks/${taskId}`, 'PATCH', reviewer,
    { action: 'claim', expectedVersion: 1, operationId: randomUUID() }), { params: Promise.resolve({ taskId }) });
  assert.equal(lostClaim.status, 409);
  const scheduleAbsences = await scheduleAbsencesRoute.GET(call(`/api/dp/schedules/${scheduleRef.id}/absences`, 'GET', reviewer),
    { params: Promise.resolve({ scheduleId: scheduleRef.id }) });
  assert.equal(scheduleAbsences.status, 200);
  assert.deepEqual((await scheduleAbsences.json()).absences.map((item) => item.requestId), [id]);
  const activeAvailability = await natashaAvailabilityRoute.GET(call(availabilityPath, 'GET', admin), context());
  assert.equal(activeAvailability.status, 200);
  const activeReport = await activeAvailability.json();
  assert.equal(activeReport.status, 'ready_for_confirmation');
  assert.equal(activeReport.approvedAbsences.some((item) => item.id === id && item.employeeId === personUid), true);
  await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).update({ coverageThrough: addDays(startDate, -1) });
  const shortCoverage = await natashaAvailabilityRoute.GET(call(availabilityPath, 'GET', admin), context());
  assert.equal((await shortCoverage.json()).status, 'incomplete');
  await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).update({ coverageThrough: '9999-12-31' });
  await hrDbAdmin.collection('dp_absenceRequests').doc(id).update({ 'operationalFence.state': 'activation_pending' });
  const unackedAvailability = await natashaAvailabilityRoute.GET(call(availabilityPath, 'GET', admin), context());
  assert.equal((await unackedAvailability.json()).status, 'incomplete');
  await hrDbAdmin.collection('dp_absenceRequests').doc(id).update({ 'operationalFence.state': 'active' });
  const occurrence = await hrDbAdmin.collection('dp_absenceOccurrences').doc(id).get();
  assert.equal(occurrence.get('projectionStatus'), 'active');
  assert.equal((await hrDbAdmin.collection('dp_absenceOutbox').doc(`${id}_4_operational_activation_pending`).get()).get('status'), 'done');
  await assert.rejects(bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true,
    maxPerSource: 1 }), /limite/);
  assert.equal((await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).get()).get('state'), 'bootstrapping');
  await bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true });
  const orphanProjection = dbAdmin.collection('dp_absenceOperationalAvailability').doc(`orphan-${suffix}`);
  await orphanProjection.set({ requestId: orphanProjection.id, workspaceId, state: 'active',
    epoch: (await dbAdmin.collection('dp_absenceOperationalReadiness').doc(workspaceId).get()).get('epoch') });
  await assert.rejects(bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true }), /projeção órfã/);
  await orphanProjection.delete();
  await bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true });
  const activationOutbox = hrDbAdmin.collection('dp_absenceOutbox').doc(`${id}_4_operational_activation_pending`);
  await activationOutbox.update({ status: 'pending' });
  await assert.rejects(bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true }), /outbox operacional pendente/);
  await activationOutbox.update({ status: 'done' });
  await bootstrapAbsenceOperationalReadiness({ workspaceId,
    coverageFrom: '1900-01-01', coverageThrough: '9999-12-31', quiescenceConfirmed: true });
  const retriedActivation = await reconcileRoute.POST(call(`/api/dp/absence-operational/${id}/reconcile`, 'POST', reviewer,
    { expectedVersion: 4, action: 'activate' }), context(id));
  assert.equal(retriedActivation.status, 200);
  assert.equal((await hrDbAdmin.collection('dp_absenceOutbox').doc(`${id}_4_operational_activation_pending`).get()).get('status'), 'done');
  const marker = await operationalDayRefs(workspaceId, personUid, startDate).marker.get();
  assert.ok(marker.get('entries').some((entry) => entry.requestVersion === 4 && entry.state === 'active'));
  await assert.rejects(dbAdmin.runTransaction(async (tx) => guardOccupancyWrite(tx, workspaceId,
    shiftOccupancySlices({ beneficiaryUid: personUid, date: startDate, startTime: '10:00', endTime: '12:00', addsOccupancy: true }), 1)));
  await assert.rejects(dbAdmin.runTransaction(async (tx) => guardOccupancyWrite(tx, workspaceId,
    shiftOccupancySlices({ beneficiaryUid: personUid, date: addDays(startDate, -1),
      startTime: '22:00', endTime: '06:00', addsOccupancy: true }), 1)));
  await assert.rejects(dbAdmin.runTransaction(async (tx) => guardOccupancyWrite(tx, workspaceId,
    vacationOccupancySlices({ beneficiaryUid: personUid, startDate, endDate: startDate,
      addsOccupancy: true }), 2, 'any_absence')));

  const cancelled = await itemRoute.PATCH(call(path, 'PATCH', reviewer,
    { action: 'cancel', expectedVersion: 4, operationId: randomUUID(), reason: 'Cancelamento futuro solicitado pelo DP.' }), context(id));
  assert.equal(cancelled.status, 200);
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').doc(id).get()).get('projectionStatus'), 'reversed');
  const reversedMarker = await operationalDayRefs(workspaceId, personUid, startDate).marker.get();
  assert.equal(reversedMarker.get('entries').some((entry) => entry.requestVersion === 4), false);
  assert.equal((await dbAdmin.collection('dp_absenceOperationalFences').doc(id).get()).get('state'), 'tombstone');
  assert.equal((await dbAdmin.collection('dp_absenceOperationalAvailability').doc(id).get()).get('state'), 'tombstone');
  const cancellationReview = await dbAdmin.collection('dp_responsibilityTasks').doc(`${id}_cancellation_review`).get();
  assert.equal(cancellationReview.get('status'), 'pending');
  const reversedAvailability = await natashaAvailabilityRoute.GET(call(availabilityPath, 'GET', admin), context());
  assert.equal(reversedAvailability.status, 200);
  const reversedReport = await reversedAvailability.json();
  assert.equal(reversedReport.approvedAbsences.some((item) => item.id === id), false);
  assert.equal((await reconcileRoute.POST(call(`/api/dp/absence-operational/${id}/reconcile`, 'POST', reviewer,
    { expectedVersion: 5, action: 'reverse' }), context(id))).status, 200);
  const approvedIntent = (await operationalIntentRef(id, 3).get()).data();
  await assert.rejects(() => activateOperationalAbsence(approvedIntent));

  const nextDate = addDays(startDate, 2);
  const nextPreview = { ...preview, startDate: nextDate, endDate: nextDate };
  const nextCreated = await collectionRoute.POST(call(pathname, 'POST', person,
    { idempotencyKey: randomUUID(), request: nextPreview, preparationIds: [] }), context());
  assert.equal(nextCreated.status, 201);
  const nextId = (await nextCreated.json()).request.id;
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${nextId}`, 'PATCH', person,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), context(nextId))).status, 200);
  const nextRecord = (await hrDbAdmin.collection('dp_absenceRequests').doc(nextId).get()).data();
  const nextOperation = randomUUID();
  const action = { action: 'approve', expectedVersion: 2, operationId: nextOperation };
  const actionHash = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  const intent = await beginOperationalIntent(nextRecord, reviewerUid, nextOperation, actionHash);
  const prepared = await prepareOperationalAbsence(intent);
  await markOperationalIntentPrepared(intent, prepared.epoch);
  await requestOperationalAbort(intent);
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${nextId}`, 'PATCH', reviewer, action), context(nextId))).status, 409);
  await abortOperationalIntent(intent);
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(nextId).get()).get('version'), 3);
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').doc(nextId).get()).exists, false);
  assert.equal((await dbAdmin.collection('dp_absenceOperationalFences').doc(nextId).get()).get('state'), 'tombstone');
});
