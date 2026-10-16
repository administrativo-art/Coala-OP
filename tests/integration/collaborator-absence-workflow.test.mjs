import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

const projectId = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId });
enableServerOnlyTestImports(projectId);
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { belemCivilDate } = await import('../../src/features/dp/absences/requests/core.ts');
const collectionRoute = await import('../../src/app/api/collaborator/absence-requests/route.ts');
const itemRoute = await import('../../src/app/api/collaborator/absence-requests/[requestId]/route.ts');
const notificationsRoute = await import('../../src/app/api/user-notifications/route.ts');
const { dispatchAbsenceNotification } = await import('../../src/features/dp/absences/requests/notifications.server.ts');
const { absenceDaySegments } = await import('../../src/features/dp/absences/requests/reservations.ts');
const { requireUser } = await import('../../src/lib/auth-server.ts');
const { prepareAbsenceFiles } = await import('../../src/features/dp/absences/requests/files.server.ts');
const { createAbsenceDraft, actOnAbsenceRequest } = await import('../../src/features/dp/absences/requests/workflow.server.ts');
const { readAbsenceAttachment, removeAbsenceAttachment } = await import('../../src/features/dp/absences/requests/attachment-access.server.ts');
const shadowRoute = await import('../../src/app/api/dp/absence-availability/[requestId]/reconcile/route.ts');

const suffix = randomUUID().slice(0, 8);
const personUid = `absence-flow-person-${suffix}`;
const reviewerUid = `absence-flow-reviewer-${suffix}`;
const adminUid = `absence-flow-admin-${suffix}`;
const unitId = `absence-flow-unit-${suffix}`;
const typeId = `absence-flow-type-${suffix}`;
const password = 'absence-flow-123';
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const startDate = addDays(belemCivilDate(new Date()), 2);
const endDate = addDays(startDate, 2);
const preview = { absenceTypeId: typeId, startDate, endDate, unit: 'day' };
const pathname = '/api/collaborator/absence-requests';
const context = { params: Promise.resolve({}) };
const itemContext = (requestId) => ({ params: Promise.resolve({ requestId }) });

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
function call(path, method, token, body) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function seed() {
  for (const [uid, profileId] of [[personUid, 'absence-flow-person-profile'], [reviewerUid, 'absence-flow-review-profile'], [adminUid, 'absence-flow-admin-profile']]) {
    await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
    await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
  }
  const batch = dbAdmin.batch();
  batch.set(dbAdmin.collection('profiles').doc('absence-flow-person-profile'), { permissions: { dashboard: { collaborator: true } } });
  batch.set(dbAdmin.collection('profiles').doc('absence-flow-review-profile'), { permissions: { dashboard: { collaborator: false }, dp: { requests: { review: true, view: true } } } });
  batch.set(dbAdmin.collection('profiles').doc('absence-flow-admin-profile'), { isDefaultAdmin: true, permissions: {} });
  for (const [uid, profileId] of [[personUid, 'absence-flow-person-profile'], [reviewerUid, 'absence-flow-review-profile'], [adminUid, 'absence-flow-admin-profile']]) {
    batch.set(dbAdmin.collection('users').doc(uid), { username: uid, email: `${uid}@example.test`, profileId, isActive: true,
      sessionVersion: 0, employmentRelationshipType: 'clt', unitId, unitIds: [unitId], profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
  batch.set(dbAdmin.collection('dp_units').doc(unitId), { name: 'Unidade teste ausência' });
  await batch.commit();
  await hrDbAdmin.collection('dp_absenceTypes').doc(typeId).set({ lineageId: typeId, version: 1, status: 'published',
    publishedAt: new Date(), name: 'Ausência teste', color: 'blue', requestUnits: ['day'], initiatedBy: ['collaborator'],
    validFrom: '1900-01-01', validTo: '9999-12-31', workdayEffect: 'excused_absence', blocksSchedule: true, includeInAbsenteeism: true,
    policies: [{ id: 'policy', name: 'Regra teste', employmentRelationshipTypes: ['clt'], applicability: { scope: { kind: 'company' } },
      calculation: 'calendar_days', attachment: 'not_required', approvalFlow: 'dp',
      approvalAssignments: { dp: [{ kind: 'people', personIds: [reviewerUid] }] },
      rejectionReasonRequired: true, allowFutureEdit: false, allowFutureCancel: false, maxUnitsPerPeriod: 5, limitPeriod: 'month' }],
  });
}

test('gate RH, criação própria, revisão atribuída, CAS, sobreposição e ocorrência única', async (t) => {
  const previous = process.env.DP_ABSENCE_CATALOG_DATABASE;
  t.after(() => { if (previous === undefined) delete process.env.DP_ABSENCE_CATALOG_DATABASE; else process.env.DP_ABSENCE_CATALOG_DATABASE = previous; });
  delete process.env.DP_ABSENCE_CATALOG_DATABASE;
  t.after(async () => {
    await Promise.allSettled([
      authAdmin.deleteUser(personUid), authAdmin.deleteUser(reviewerUid), authAdmin.deleteUser(adminUid),
      dbAdmin.collection('users').doc(personUid).delete(), dbAdmin.collection('users').doc(reviewerUid).delete(), dbAdmin.collection('users').doc(adminUid).delete(),
      dbAdmin.collection('profiles').doc('absence-flow-person-profile').delete(),
      dbAdmin.collection('profiles').doc('absence-flow-review-profile').delete(),
      dbAdmin.collection('profiles').doc('absence-flow-admin-profile').delete(),
      dbAdmin.collection('dp_units').doc(unitId).delete(), hrDbAdmin.collection('dp_absenceTypes').doc(typeId).delete(),
      hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active').delete(),
    ]);
  });
  await seed();
  const [person, reviewer, admin] = await Promise.all([signIn(personUid), signIn(reviewerUid), signIn(adminUid)]);
  const createBody = { idempotencyKey: randomUUID(), request: preview, preparationIds: [] };
  assert.equal((await collectionRoute.POST(call(pathname, 'POST', person, createBody), context)).status, 409);
  process.env.DP_ABSENCE_CATALOG_DATABASE = 'coala-rh';
  assert.equal((await collectionRoute.POST(call(pathname, 'POST', person, createBody), context)).status, 409);
  await hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active').set({ state: 'ready', catalogDatabase: 'coala-rh' });
  assert.equal((await collectionRoute.POST(call(pathname, 'POST', person, { ...createBody, beneficiaryUid: reviewerUid }), context)).status, 404);
  const created = await collectionRoute.POST(call(pathname, 'POST', person, createBody), context);
  assert.equal(created.status, 201);
  const record = (await created.json()).request;
  assert.equal(record.status, 'draft');
  assert.equal(record.quantity, 3);
  assert.equal((await collectionRoute.POST(call(pathname, 'POST', person, createBody), context)).status, 201);
  assert.equal((await collectionRoute.GET(call(`${pathname}?scope=mine`, 'GET', reviewer), context)).status, 403);
  const itemPath = `${pathname}/${record.id}`;
  const submit = await itemRoute.PATCH(call(itemPath, 'PATCH', person, { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(record.id));
  assert.equal(submit.status, 200);
  const submittedRequest = (await submit.json()).request;
  assert.equal(submittedRequest.status, 'in_review');
  assert.equal(submittedRequest.reviewSla, undefined);
  const ownSubmittedDetail = await itemRoute.GET(call(itemPath, 'GET', person), itemContext(record.id));
  assert.equal(ownSubmittedDetail.status, 200);
  const ownSubmittedRequest = (await ownSubmittedDetail.json()).request;
  assert.equal(ownSubmittedRequest.reviewSla, undefined);
  assert.equal(ownSubmittedRequest.preflight.approvalSlaHours, undefined);
  const assigned = await collectionRoute.GET(call(`${pathname}?scope=review`, 'GET', reviewer), context);
  assert.equal(assigned.status, 200);
  const assignedRequests = (await assigned.json()).requests;
  assert.deepEqual(assignedRequests.map((row) => row.id), [record.id]);
  assert.equal(assignedRequests[0].reviewSla.hours, 24);
  assert.equal(Date.parse(assignedRequests[0].reviewSla.deadlineAt) - Date.parse(assignedRequests[0].reviewSla.startedAt), 86_400_000);
  const internalSubmittedDetail = await itemRoute.GET(call(itemPath, 'GET', reviewer), itemContext(record.id));
  assert.equal(internalSubmittedDetail.status, 200);
  assert.equal((await internalSubmittedDetail.json()).request.preflight.approvalSlaHours, 24);
  const reviewerNotificationList = await notificationsRoute.GET(call('/api/user-notifications?limit=25', 'GET', reviewer), context);
  assert.equal(reviewerNotificationList.status, 200);
  assert.ok((await reviewerNotificationList.json()).notifications
    .some((item) => item.body === 'Você tem uma solicitação para analisar. Prazo: 24 horas.'));
  const second = await collectionRoute.POST(call(pathname, 'POST', person, { idempotencyKey: randomUUID(), request: preview, preparationIds: [] }), context);
  assert.equal(second.status, 201);
  const other = (await second.json()).request;
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${other.id}`, 'PATCH', person, { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(other.id))).status, 409);
  assert.equal((await itemRoute.PATCH(call(itemPath, 'PATCH', reviewer, { action: 'reject', expectedVersion: 2, operationId: randomUUID() }), itemContext(record.id))).status, 400);
  const approved = await itemRoute.PATCH(call(itemPath, 'PATCH', reviewer, { action: 'approve', expectedVersion: 2, operationId: randomUUID() }), itemContext(record.id));
  assert.equal(approved.status, 200);
  const approvedRequest = (await approved.json()).request;
  assert.equal(approvedRequest.status, 'approved');
  assert.equal(approvedRequest.reviewSla, undefined);
  assert.equal((await itemRoute.PATCH(call(itemPath, 'PATCH', reviewer, { action: 'approve', expectedVersion: 2, operationId: randomUUID() }), itemContext(record.id))).status, 409);
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').doc(record.id).get()).exists, true);
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').where('requestId', '==', record.id).limit(2).get()).size, 1);
  const notificationList = await notificationsRoute.GET(call('/api/user-notifications?limit=25', 'GET', person), context);
  assert.equal(notificationList.status, 200);
  const ownNotifications = (await notificationList.json()).notifications;
  assert.ok(ownNotifications.some((item) => item.body === 'Você tem uma atualização no Coala.'));
  assert.equal(ownNotifications.some((item) => /ausência|atestado|saúde/i.test(item.body)), false);
  assert.equal((await notificationsRoute.PATCH(call('/api/user-notifications', 'PATCH', reviewer,
    { ids: [ownNotifications[0].id] }), context)).status, 404);
  assert.equal((await notificationsRoute.PATCH(call('/api/user-notifications', 'PATCH', person,
    { ids: [ownNotifications[0].id] }), context)).status, 200);
  const eventRef = hrDbAdmin.collection('dp_absenceOutbox').doc(`${record.id}_3_notification_approve`);
  await eventRef.update({ status: 'retry', leaseId: null, leaseUntil: null, nextAttemptAt: '1900-01-01T00:00:00.000Z' });
  const delivered = await dispatchAbsenceNotification(record.id, 3);
  assert.equal(delivered.state, 'completed');
  assert.equal(delivered.projected, 1);
  assert.equal((await eventRef.get()).get('result.channel'), 'in_app_bell');
  assert.equal((await hrDbAdmin.collection('dp_absenceDayReservations').limit(20).get()).empty, false);
  assert.equal(absenceDaySegments(preview, { calculation: 'calendar_days', limitPeriod: 'month' }).length, 3);
  const revisedDate = addDays(endDate, 4);
  const revised = await itemRoute.PATCH(call(`${pathname}/${other.id}`, 'PATCH', person, {
    action: 'update_draft', expectedVersion: 1, operationId: randomUUID(),
    request: { ...preview, startDate: revisedDate, endDate: revisedDate }, preparationIds: [],
  }), itemContext(other.id));
  assert.equal(revised.status, 200);
  assert.equal((await revised.json()).request.revision, 2);
  assert.equal((await hrDbAdmin.collection('dp_absenceRevisions').doc(`${other.id}_1`).get()).exists, true);
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${other.id}`, 'PATCH', person,
    { action: 'submit', expectedVersion: 2, operationId: randomUUID() }), itemContext(other.id))).status, 200);
  const later = addDays(endDate, 10);
  const driftCreate = await collectionRoute.POST(call(pathname, 'POST', person, { idempotencyKey: randomUUID(),
    request: { ...preview, startDate: later, endDate: later }, preparationIds: [] }), context);
  assert.equal(driftCreate.status, 201);
  const driftId = (await driftCreate.json()).request.id;
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${driftId}`, 'PATCH', person,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(driftId))).status, 200);
  await dbAdmin.collection('users').doc(personUid).update({ employmentRelationshipType: 'pj' });
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${driftId}`, 'PATCH', reviewer,
    { action: 'approve', expectedVersion: 2, operationId: randomUUID() }), itemContext(driftId))).status, 409);
  await dbAdmin.collection('users').doc(personUid).update({ employmentRelationshipType: 'clt', isActive: false });
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${driftId}`, 'PATCH', reviewer,
    { action: 'approve', expectedVersion: 2, operationId: randomUUID() }), itemContext(driftId))).status, 409);
  await dbAdmin.collection('users').doc(personUid).update({ isActive: true, jobRoleId: 'role-a' });
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${driftId}`, 'PATCH', reviewer,
    { action: 'approve', expectedVersion: 2, operationId: randomUUID() }), itemContext(driftId))).status, 409);
  const confirmed = await itemRoute.PATCH(call(`${pathname}/${driftId}`, 'PATCH', reviewer,
    { action: 'confirm_profile', expectedVersion: 2, operationId: randomUUID(), reason: 'Histórico conferido pelo DP.' }), itemContext(driftId));
  assert.equal(confirmed.status, 200);
  await dbAdmin.collection('users').doc(personUid).update({ jobRoleId: 'role-b' });
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${driftId}`, 'PATCH', reviewer,
    { action: 'approve', expectedVersion: 3, operationId: randomUUID() }), itemContext(driftId))).status, 409);
  await dbAdmin.collection('profiles').doc('absence-flow-review-profile').update({
    'permissions.dp.collaborators.edit': true,
  });
  const onBehalfTypeId = `${typeId}-dp`;
  t.after(() => hrDbAdmin.collection('dp_absenceTypes').doc(onBehalfTypeId).delete());
  const baseType = (await hrDbAdmin.collection('dp_absenceTypes').doc(typeId).get()).data();
  const dpPolicy = { ...baseType.policies[0], approvalFlow: 'automatic', allowFutureCancel: false,
    maxUnitsPerPeriod: 20 };
  delete dpPolicy.approvalAssignments;
  await hrDbAdmin.collection('dp_absenceTypes').doc(onBehalfTypeId).set({ ...baseType,
    lineageId: onBehalfTypeId, name: 'Tipo DP', initiatedBy: ['dp'],
    policies: [dpPolicy],
  });
  const behalfDate = addDays(endDate, 20);
  const behalf = await collectionRoute.POST(call(pathname, 'POST', reviewer, { idempotencyKey: randomUUID(),
    beneficiaryUid: personUid, request: { absenceTypeId: onBehalfTypeId, startDate: behalfDate,
      endDate: behalfDate, unit: 'day' }, preparationIds: [] }), context);
  assert.equal(behalf.status, 201);
  const behalfRequest = (await behalf.json()).request;
  assert.equal(behalfRequest.origin, 'dp');
  assert.equal(behalfRequest.beneficiaryUid, personUid);
  assert.equal(behalfRequest.requesterUid, reviewerUid);
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${behalfRequest.id}`, 'PATCH', reviewer,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(behalfRequest.id))).status, 200);

  const requiredTypeId = `${typeId}-required`;
  t.after(() => hrDbAdmin.collection('dp_absenceTypes').doc(requiredTypeId).delete());
  await hrDbAdmin.collection('dp_absenceTypes').doc(requiredTypeId).set({ ...baseType,
    lineageId: requiredTypeId, name: 'Tipo comprovado',
    policies: [{ ...baseType.policies[0], attachment: 'required', maxUnitsPerPeriod: 20 }],
  });
  const fileDate = addDays(endDate, 40);
  const fileRequest = { absenceTypeId: requiredTypeId, startDate: fileDate, endDate: fileDate, unit: 'day' };
  assert.equal((await collectionRoute.POST(call(pathname, 'POST', person, {
    idempotencyKey: randomUUID(), request: fileRequest, preparationIds: [],
  }), context)).status, 400);
  const savedFiles = new Map();
  const fakeStorage = {
    async put(path, bytes) { savedFiles.set(path, Buffer.from(bytes)); return { generation: '1' }; },
    async verify(path, generation) { return generation === '1' && savedFiles.has(path); },
    async read(path) { return savedFiles.get(path); },
    async remove(path) { savedFiles.delete(path); },
  };
  const personActor = await requireUser(call(pathname, 'GET', person));
  const reviewerActor = await requireUser(call(pathname, 'GET', reviewer));
  const adminActor = await requireUser(call(pathname, 'GET', admin));
  const preparedId = randomUUID();
  const form = new FormData();
  form.set('proposedRequestId', preparedId);
  form.set('files', new File([Buffer.from('%PDF-1.7\nproof')], 'proof.pdf', { type: 'application/pdf' }));
  const prepared = await prepareAbsenceFiles(personActor, form, fakeStorage);
  assert.equal(prepared.proposedRequestId, preparedId);
  const fileDraft = await createAbsenceDraft(personActor, { idempotencyKey: randomUUID(), proposedRequestId: preparedId,
    request: fileRequest, preparationIds: prepared.preparationIds }, fakeStorage);
  assert.equal(fileDraft.status, 'draft');
  const fileRecord = await hrDbAdmin.collection('dp_absenceRequests').doc(fileDraft.id).get();
  const retentionCase = await hrDbAdmin.collection('dp_absenceRetentionCases')
    .doc(`${fileDraft.id}_${prepared.preparationIds[0]}`).get();
  assert.equal(retentionCase.get('state'), 'unanchored');
  assert.equal(retentionCase.get('custodianUid'), reviewerUid);
  assert.equal(retentionCase.get('workspaceId'), fileRecord.get('workspaceId'));
  assert.equal(retentionCase.get('storagePath'), undefined);
  await assert.rejects(removeAbsenceAttachment(reviewerActor, fileDraft.id,
    prepared.preparationIds[0], 'Exclusão legada não autorizada.', fakeStorage),
  (error) => error.code === 'ABSENCE_RETENTION_EXECUTION_NOT_READY');
  assert.equal(savedFiles.size, 1);
  const pathInStorage = fileRecord.get('attachments')[0].storagePath;
  savedFiles.delete(pathInStorage);
  await assert.rejects(actOnAbsenceRequest(personActor, fileDraft.id,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }, fakeStorage));
  savedFiles.set(pathInStorage, Buffer.from('%PDF-1.7\nproof'));
  await actOnAbsenceRequest(personActor, fileDraft.id,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }, fakeStorage);
  assert.equal((await readAbsenceAttachment(personActor, fileDraft.id, prepared.preparationIds[0], fakeStorage)).mime, 'application/pdf');
  assert.equal((await readAbsenceAttachment(reviewerActor, fileDraft.id, prepared.preparationIds[0], fakeStorage)).mime, 'application/pdf');
  savedFiles.delete(pathInStorage);
  await assert.rejects(actOnAbsenceRequest(reviewerActor, fileDraft.id,
    { action: 'approve', expectedVersion: 2, operationId: randomUUID() }, fakeStorage));
  savedFiles.set(pathInStorage, Buffer.from('%PDF-1.7\nproof'));
  const decisions = await Promise.allSettled([randomUUID(), randomUUID()].map((operationId) =>
    actOnAbsenceRequest(reviewerActor, fileDraft.id, { action: 'approve', expectedVersion: 2, operationId }, fakeStorage)));
  assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').where('requestId', '==', fileDraft.id).limit(2).get()).size, 1);
  await assert.rejects(readAbsenceAttachment(adminActor, fileDraft.id, prepared.preparationIds[0], fakeStorage));
  assert.equal((await readAbsenceAttachment(reviewerActor, fileDraft.id, prepared.preparationIds[0], fakeStorage)).mime, 'application/pdf');
  await dbAdmin.collection('profiles').doc('absence-flow-review-profile').update({ 'permissions.dp.requests.review': false });
  const revokedReviewer = await requireUser(call(pathname, 'GET', reviewer));
  await assert.rejects(readAbsenceAttachment(revokedReviewer, fileDraft.id, prepared.preparationIds[0], fakeStorage));
  assert.equal((await readAbsenceAttachment(personActor, fileDraft.id, prepared.preparationIds[0], fakeStorage)).mime, 'application/pdf');
  await dbAdmin.collection('profiles').doc('absence-flow-review-profile').update({
    'permissions.dp.requests.review': true, 'permissions.dp.schedules.edit': true,
  });
  const shiftsBefore = (await dbAdmin.collectionGroup('shifts').where('userId', '==', personUid).limit(201).get())
    .docs.map((doc) => ({ path: doc.ref.path, data: doc.data() }));
  const shadowPath = `/api/dp/absence-availability/${fileDraft.id}/reconcile`;
  const shadowContext = itemContext(fileDraft.id);
  const shadowOperation = { expectedVersion: 3, operationId: randomUUID() };
  assert.equal((await shadowRoute.POST(call(shadowPath, 'POST', person, shadowOperation), shadowContext)).status, 403);
  assert.equal((await shadowRoute.POST(call(shadowPath, 'POST', reviewer,
    { ...shadowOperation, workspaceId: 'forged' }), shadowContext)).status, 400);
  const shadowCreated = await shadowRoute.POST(call(shadowPath, 'POST', reviewer, shadowOperation), shadowContext);
  assert.equal(shadowCreated.status, 200);
  assert.deepEqual((await shadowCreated.json()).mode, 'shadow');
  assert.equal((await shadowRoute.POST(call(shadowPath, 'POST', reviewer, shadowOperation), shadowContext)).status, 200);
  const shadowDoc = await hrDbAdmin.collection('dp_absenceAvailabilityShadow').doc(fileDraft.id).get();
  assert.equal(shadowDoc.get('operationallyApplied'), false);
  assert.equal(shadowDoc.get('shadow'), true);
  assert.equal(shadowDoc.get('state'), 'active');
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').doc(fileDraft.id).get()).get('projectionStatus'), 'pending');
  const cancelTypeId = `${typeId}-cancel`;
  t.after(() => hrDbAdmin.collection('dp_absenceTypes').doc(cancelTypeId).delete());
  await hrDbAdmin.collection('dp_absenceTypes').doc(cancelTypeId).set({ ...baseType,
    lineageId: cancelTypeId, name: 'Tipo reversível',
    policies: [{ ...baseType.policies[0], allowFutureCancel: true, maxUnitsPerPeriod: 1 }],
  });
  const cancelPeriod = addDays(belemCivilDate(new Date()), 120).slice(0, 7);
  const cancelDate = `${cancelPeriod}-10`;
  const cancelBody = { absenceTypeId: cancelTypeId, startDate: cancelDate, endDate: cancelDate, unit: 'day' };
  const cancelCreated = await collectionRoute.POST(call(pathname, 'POST', person,
    { idempotencyKey: randomUUID(), request: cancelBody, preparationIds: [] }), context);
  assert.equal(cancelCreated.status, 201);
  const cancelId = (await cancelCreated.json()).request.id;
  const cancelPath = `${pathname}/${cancelId}`;
  assert.equal((await itemRoute.PATCH(call(cancelPath, 'PATCH', person,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(cancelId))).status, 200);
  const quotaDate = `${cancelPeriod}-12`;
  const quotaCreated = await collectionRoute.POST(call(pathname, 'POST', person,
    { idempotencyKey: randomUUID(), request: { ...cancelBody, startDate: quotaDate, endDate: quotaDate },
      preparationIds: [] }), context);
  assert.equal(quotaCreated.status, 201);
  const quotaId = (await quotaCreated.json()).request.id;
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${quotaId}`, 'PATCH', person,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(quotaId))).status, 409);
  assert.equal((await itemRoute.PATCH(call(cancelPath, 'PATCH', reviewer,
    { action: 'approve', expectedVersion: 2, operationId: randomUUID() }), itemContext(cancelId))).status, 200);
  const cancelShadowPath = `/api/dp/absence-availability/${cancelId}/reconcile`;
  const cancelShadowOperation = { expectedVersion: 3, operationId: randomUUID() };
  assert.equal((await shadowRoute.POST(call(cancelShadowPath, 'POST', reviewer, cancelShadowOperation),
    itemContext(cancelId))).status, 200);
  assert.equal((await itemRoute.PATCH(call(cancelPath, 'PATCH', reviewer,
    { action: 'cancel', expectedVersion: 3, operationId: randomUUID(), reason: 'Cancelamento futuro autorizado pelo DP.' }), itemContext(cancelId))).status, 200);
  assert.equal((await hrDbAdmin.collection('dp_absenceReversals').doc(`${cancelId}_4`).get()).exists, true);
  assert.equal((await shadowRoute.POST(call(cancelShadowPath, 'POST', reviewer,
    { expectedVersion: 4, operationId: randomUUID() }), itemContext(cancelId))).status, 200);
  const reversed = await hrDbAdmin.collection('dp_absenceAvailabilityShadow').doc(cancelId).get();
  assert.equal(reversed.get('state'), 'reversed');
  assert.deepEqual(reversed.get('intervals'), []);
  assert.equal((await shadowRoute.POST(call(cancelShadowPath, 'POST', reviewer, cancelShadowOperation),
    itemContext(cancelId))).status, 409);
  assert.equal((await itemRoute.PATCH(call(`${pathname}/${quotaId}`, 'PATCH', person,
    { action: 'submit', expectedVersion: 1, operationId: randomUUID() }), itemContext(quotaId))).status, 200);
  assert.equal((await hrDbAdmin.collection('dp_absenceOccurrences').doc(cancelId).get()).get('projectionStatus'), 'pending');
  const shiftsAfter = (await dbAdmin.collectionGroup('shifts').where('userId', '==', personUid).limit(201).get())
    .docs.map((doc) => ({ path: doc.ref.path, data: doc.data() }));
  assert.deepEqual(shiftsAfter, shiftsBefore);
  const annualTypeId = `${typeId}-annual`;
  t.after(() => hrDbAdmin.collection('dp_absenceTypes').doc(annualTypeId).delete());
  await hrDbAdmin.collection('dp_absenceTypes').doc(annualTypeId).set({ ...baseType,
    lineageId: annualTypeId, name: 'Tipo anual',
    policies: [{ ...baseType.policies[0], limitPeriod: 'year', maxUnitsPerPeriod: 1 }],
  });
  // Mesmo ano civil e janela distante dos demais cenários, inclusive na virada.
  const annualA = `${Number(belemCivilDate(new Date()).slice(0, 4)) + 1}-06-10`;
  const annualB = addDays(annualA, 3);
  const annualCreate = async (date) => {
    const response = await collectionRoute.POST(call(pathname, 'POST', person,
      { idempotencyKey: randomUUID(), request: { absenceTypeId: annualTypeId, startDate: date,
        endDate: date, unit: 'day' }, preparationIds: [] }), context);
    assert.equal(response.status, 201);
    return (await response.json()).request.id;
  };
  const annualFirst = await annualCreate(annualA);
  const annualSecond = await annualCreate(annualB);
  const annualAction = (id, token, action, expectedVersion, reason) => itemRoute.PATCH(call(`${pathname}/${id}`, 'PATCH', token,
    { action, expectedVersion, operationId: randomUUID(), ...(reason ? { reason } : {}) }), itemContext(id));
  assert.equal((await annualAction(annualFirst, person, 'submit', 1)).status, 200);
  assert.equal((await annualAction(annualSecond, person, 'submit', 1)).status, 409);
  assert.equal((await annualAction(annualFirst, reviewer, 'request_adjustments', 2,
    'Corrija as datas e reenvie a solicitação.')).status, 200);
  assert.equal((await annualAction(annualSecond, person, 'submit', 1)).status, 200);
  assert.equal((await annualAction(annualSecond, reviewer, 'reject', 2,
    'Documento ou período não atende à regra.')).status, 200);
  assert.equal((await annualAction(annualFirst, person, 'submit', 3)).status, 200);
});
