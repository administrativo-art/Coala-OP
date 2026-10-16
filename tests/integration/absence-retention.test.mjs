import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

const projectId = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId });
enableServerOnlyTestImports(projectId);
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { WORKSPACE_ID } = await import('../../src/lib/workspace.ts');
const { terminationCivilDate, retentionReviewAfter } = await import('../../src/features/dp/absences/requests/files.server.ts');
const { executeAbsenceRetention } = await import('../../src/features/dp/absences/requests/retention.server.ts');
const { setEmploymentCyclePatch } = await import('../../src/lib/employment-cycle.server.ts');
const { retentionCivilDate, retentionReviewDate, reconcileAbsenceRetentionPage,
  detectDueAbsenceRetention, reconcileAbsenceRetentionExecution: reconcileScheduledExecution } = await import('../../functions/src/absence-retention.ts');
const listRoute = await import('../../src/app/api/dp/absence-retention/route.ts');
const decisionRoute = await import('../../src/app/api/dp/absence-retention/[caseId]/decision/route.ts');
const suffix = randomUUID().slice(0, 8);
const personUid = `retention-person-${suffix}`;
const custodianUid = `retention-custodian-${suffix}`;
const outsiderUid = `retention-outsider-${suffix}`;
const unitId = `retention-unit-${suffix}`;
const password = 'retention-123';
const requestIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const fileIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const caseIds = requestIds.map((id, i) => `${id}_${fileIds[i]}`);
const call = (path, method, token, body) => new NextRequest(`http://localhost${path}`, { method,
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}) });
const context = (caseId) => ({ params: Promise.resolve({ caseId }) });
async function signIn(uid) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${uid}@example.test`, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}
async function seed() {
  for (const uid of [personUid, custodianUid, outsiderUid]) {
    await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
    await authAdmin.setCustomUserClaims(uid, { profileId: `${uid}-profile`, sessionVersion: uid === personUid ? 1 : 0 });
  }
  const batch = dbAdmin.batch();
  batch.set(dbAdmin.collection('users').doc(personUid), { isActive: false, sessionVersion: 1, employmentCycleVersion: 7,
    terminationDate: Timestamp.fromDate(new Date('2006-10-14T00:00:00Z')), profileId: `${personUid}-profile`, unitIds: [unitId] });
  batch.set(dbAdmin.collection('users').doc(custodianUid), { isActive: true, sessionVersion: 0,
    profileId: `${custodianUid}-profile`, unitIds: [unitId],
    profileCompliance: { status: 'complete', policyVersion: 1 } });
  batch.set(dbAdmin.collection('users').doc(outsiderUid), { isActive: true, sessionVersion: 0,
    profileId: `${outsiderUid}-profile`, unitIds: [],
    profileCompliance: { status: 'complete', policyVersion: 1 } });
  batch.set(dbAdmin.collection('profiles').doc(`${custodianUid}-profile`), { permissions: { dp: { requests: { review: true } } } });
  batch.set(dbAdmin.collection('profiles').doc(`${outsiderUid}-profile`), { permissions: { dp: { requests: { review: true } } } });
  await batch.commit();
  const rhBatch = hrDbAdmin.batch();
  requestIds.forEach((id, i) => rhBatch.set(hrDbAdmin.collection('dp_absenceRequests').doc(id), {
    workspaceId: WORKSPACE_ID, beneficiaryUid: personUid, requesterUid: personUid,
    unitId, custodianDpUid: custodianUid, status: 'rejected', version: 2,
    attachments: [{ id: fileIds[i], mime: 'application/pdf', size: 20, sha256: `sha-${i}`,
      storagePath: `absence-requests/${WORKSPACE_ID}/${id}/${personUid}/${fileIds[i]}`, generation: `${i + 1}`,
      classification: 'sensitive', retention: { policy: 'employment_plus_20_years',
        terminationDate: '2006-10-14', reviewAfter: '2026-10-14' } }],
  }));
  await rhBatch.commit();
}

async function reconcileAll(user, pageSize = 1) {
  let result;
  do result = await reconcileAbsenceRetentionPage(dbAdmin, hrDbAdmin, WORKSPACE_ID, personUid, user, pageSize);
  while (result.state !== 'completed');
  return result;
}

async function cleanup() {
  const [notifications, reconciliations, audits, operations, receipts] = await Promise.all([
    dbAdmin.collection('userNotifications').where('ownerUid', '==', custodianUid).get(),
    hrDbAdmin.collection('dp_absenceRetentionReconciliations').where('beneficiaryUid', '==', personUid).get(),
    hrDbAdmin.collection('dp_absenceRetentionAudit').where('beneficiaryUid', '==', personUid).get(),
    hrDbAdmin.collection('dp_absenceRetentionOperations').where('actorUid', '==', custodianUid).get(),
    hrDbAdmin.collection('dp_absenceRetentionExecutionReceipts').where('actorUid', '==', custodianUid).get(),
  ]);
  await Promise.all([
    ...notifications.docs.map((document) => document.ref.delete()),
    ...reconciliations.docs.map((document) => document.ref.delete()),
    ...audits.docs.map((document) => document.ref.delete()),
    ...operations.docs.map((document) => document.ref.delete()),
    ...receipts.docs.map((document) => document.ref.delete()),
    ...caseIds.map((id) => hrDbAdmin.collection('dp_absenceRetentionCases').doc(id).delete()),
    ...requestIds.map((id) => hrDbAdmin.collection('dp_absenceRequests').doc(id).delete()),
    dbAdmin.collection('users').doc(personUid).delete(),
    dbAdmin.collection('users').doc(custodianUid).delete(),
    dbAdmin.collection('users').doc(outsiderUid).delete(),
    dbAdmin.collection('profiles').doc(`${custodianUid}-profile`).delete(),
    dbAdmin.collection('profiles').doc(`${outsiderUid}-profile`).delete(),
    ...[personUid, custodianUid, outsiderUid].map((uid) => authAdmin.deleteUser(uid).catch(() => undefined)),
  ]);
}

test('retenção: civil, autorização, fence concorrente, geração exata e reconciliação', async (t) => {
  t.after(cleanup);
  assert.equal(terminationCivilDate('2080-02-29'), '2080-02-29');
  assert.equal(retentionCivilDate('2080-02-29'), '2080-02-29');
  assert.equal(retentionReviewAfter('2080-02-29'), '2100-02-28');
  assert.equal(retentionReviewDate('2080-02-29'), '2100-02-28');
  assert.equal(terminationCivilDate(Timestamp.fromDate(new Date('2006-10-14T00:00:00Z'))), '2006-10-14');
  assert.equal(terminationCivilDate('2026-02-31'), null);
  await seed();
  const person = await dbAdmin.collection('users').doc(personUid).get();
  assert.equal((await reconcileAbsenceRetentionPage(dbAdmin, hrDbAdmin, WORKSPACE_ID, personUid, person, 1)).state, 'pending');
  await reconcileAll(person);
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[0]).get()).get('state'), 'scheduled');
  const notificationRun = await detectDueAbsenceRetention(dbAdmin, hrDbAdmin, '2026-10-15');
  assert.equal(notificationRun.projected, 4);
  assert.equal((await detectDueAbsenceRetention(dbAdmin, hrDbAdmin, '2026-10-15')).projected, 0);
  assert.equal((await dbAdmin.collection('userNotifications').where('ownerUid', '==', custodianUid).limit(5).get()).size, 4);
  const [custodianToken, outsiderToken] = await Promise.all([signIn(custodianUid), signIn(outsiderUid)]);
  const listPath = `/api/dp/absence-retention?unitId=${unitId}&state=awaiting_authorization&limit=1`;
  const listed = await listRoute.GET(call(listPath, 'GET', custodianToken));
  assert.equal(listed.status, 200, JSON.stringify(await listed.clone().json()));
  assert.equal((await listed.json()).cases.length, 1);
  assert.equal((await listRoute.GET(call(listPath, 'GET', outsiderToken))).status, 403);
  const firstPath = `/api/dp/absence-retention/${caseIds[0]}/decision`;
  const firstBody = { action: 'authorize_delete', reason: 'Revisão do prazo legal confirmada pelo DP.',
    expectedVersion: 2, operationId: randomUUID() };
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[0]).get()).get('version'), 2);
  const concurrent = await Promise.all([firstBody, { ...firstBody, operationId: randomUUID() }].map((body) =>
    decisionRoute.POST(call(firstPath, 'POST', custodianToken, body), context(caseIds[0]))));
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409],
    JSON.stringify(await Promise.all(concurrent.map((response) => response.clone().json()))));
  const firstCase = await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[0]).get();
  assert.equal(firstCase.get('state'), 'authorized');
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(requestIds[0]).get()).get('attachments')[0].deletion, undefined);
  const actor = { decoded: { uid: custodianUid }, workspace_id: WORKSPACE_ID, isDefaultAdmin: false,
    permissions: { dp: { requests: { review: true } } }, userDoc: { id: custodianUid, unitIds: [unitId] } };
  let removalStarted;
  let continueRemoval;
  const started = new Promise((resolve) => { removalStarted = resolve; });
  const release = new Promise((resolve) => { continueRemoval = resolve; });
  const present = new Set(fileIds.slice(0, 3));
  const store = { bucketName: 'demo-bucket',
    async inspect(storagePath) { return present.has(storagePath.split('/').at(-1)) ? 'exact' : 'missing'; },
    async removeExact(storagePath) { removalStarted(); await release; present.delete(storagePath.split('/').at(-1)); return 'removed'; } };
  const executionPromise = executeAbsenceRetention(actor, caseIds[0], 3, randomUUID(), store);
  await started;
  await assert.rejects(dbAdmin.runTransaction(async (tx) => {
    const ref = dbAdmin.collection('users').doc(personUid);
    const current = await tx.get(ref);
    setEmploymentCyclePatch(tx, ref, current, { isActive: true, employmentStatus: 'active' }, { cycleMutation: true });
  }), /temporariamente bloqueado/);
  continueRemoval();
  const execution = await executionPromise;
  assert.equal(execution.state, 'removed');
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(requestIds[0]).get()).get('attachments')[0].deletion.state, 'removed');
  assert.equal((await dbAdmin.collection('users').doc(personUid).get()).get('absenceDocumentDeletionFence'), undefined);
  const retain = await decisionRoute.POST(call(`/api/dp/absence-retention/${caseIds[1]}/decision`, 'POST', custodianToken,
    { action: 'retain', reason: 'Manter o documento para nova revisão expressa.',
      nextReviewAfter: '2027-10-15', expectedVersion: 2, operationId: randomUUID() }), context(caseIds[1]));
  assert.equal(retain.status, 200);
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[1]).get()).get('state'), 'retained_until_review');
  await dbAdmin.collection('users').doc(personUid).update({ terminationDate: '2007-10-14' });
  const corrected = await dbAdmin.collection('users').doc(personUid).get();
  await reconcileAll(corrected);
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[1]).get()).get('state'), 'needs_revalidation');
  await dbAdmin.collection('users').doc(personUid).update({ isActive: true, sessionVersion: 2 });
  const readmitted = await dbAdmin.collection('users').doc(personUid).get();
  await reconcileAll(readmitted);
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[1]).get()).get('state'), 'needs_revalidation');

  await dbAdmin.collection('users').doc(personUid).update({ isActive: false, sessionVersion: 1,
    employmentCycleVersion: 7, terminationDate: Timestamp.fromDate(new Date('2006-10-14T00:00:00Z')) });
  const restored = await dbAdmin.collection('users').doc(personUid).get();
  await reconcileAll(restored, 20);
  await detectDueAbsenceRetention(dbAdmin, hrDbAdmin, '2026-10-15');
  for (const index of [2, 3]) {
    const current = await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[index]).get();
    const response = await decisionRoute.POST(call(`/api/dp/absence-retention/${caseIds[index]}/decision`, 'POST', custodianToken,
      { action: 'authorize_delete', reason: 'Revisão do prazo legal confirmada pelo DP.',
        expectedVersion: current.get('version'), operationId: randomUUID() }), context(caseIds[index]));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }
  let uncertainOnce = true;
  const unknownStore = { ...store, async removeExact(storagePath) {
    present.delete(storagePath.split('/').at(-1));
    if (uncertainOnce) { uncertainOnce = false; throw new Error('resposta perdida'); }
    return 'missing';
  } };
  const unknownVersion = (await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[2]).get()).get('version');
  await assert.rejects(executeAbsenceRetention(actor, caseIds[2], unknownVersion, randomUUID(), unknownStore),
    /conferido automaticamente/);
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[2]).get()).get('state'), 'execution_unknown');
  const unknownCase = await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[2]).get();
  const scheduledStore = { bucketName: 'demo-bucket',
    async inspect(target) { return present.has(target.storagePath.split('/').at(-1)) ? 'exact' : 'missing'; },
    async removeExact(target) { present.delete(target.storagePath.split('/').at(-1)); return 'removed'; } };
  assert.equal(await reconcileScheduledExecution(dbAdmin, hrDbAdmin, unknownCase, scheduledStore), 'removed');

  const differentStore = { ...store, async inspect() { return 'different'; } };
  const differentVersion = (await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[3]).get()).get('version');
  await assert.rejects(executeAbsenceRetention(actor, caseIds[3], differentVersion, randomUUID(), differentStore),
    /outra versão/);
  assert.equal((await hrDbAdmin.collection('dp_absenceRetentionCases').doc(caseIds[3]).get()).get('state'), 'execution_review_required');
  assert.equal((await dbAdmin.collection('users').doc(personUid).get()).get('absenceDocumentDeletionFence.state'), 'review_required');
});
