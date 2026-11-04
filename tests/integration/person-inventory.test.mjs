import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const PROJECT_ID = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { financialDbAdmin } = await import('../../src/lib/firebase-financial-admin.ts');
const { requireUser } = await import('../../src/lib/auth-server.ts');
const { collectPersonSource } = await import('../../src/features/privacy/person-inventory.server.ts');
const route = await import('../../src/app/api/privacy/person-inventory/route.ts');
const requestRoute = await import('../../src/app/api/privacy/requests/route.ts');
const password = 'person-inventory-test-123';
test('readonly census paginates emulator, scopes tenant, excludes PII, and binds dry-run to manifest', async () => {
  for (const id of ['a', 'b', 'c']) await dbAdmin.collection('users').doc(`census-${id}`).set({ workspaceId: 'census-w', employeeId: `employee-${id}`, cpf: 'hidden-cpf', email: 'hidden@example.test', token: 'hidden-token' });
  await dbAdmin.collection('users').doc('census-other').set({ workspaceId: 'other-w', employeeId: 'other', cpf: 'hidden-cpf' });
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', PROJECT_ID, '--workspace', 'census-w', '--sources', 'main/users', '--page-size', '2', '--max-reads-per-source', '10', '--max-pages-per-source', '5'], { encoding: 'utf8', env: process.env });
  assert.equal(run.status, 0, run.stderr);
  const { outDir } = JSON.parse(run.stdout.trim());
  try {
    const raw = readFileSync(`${outDir}/census.jsonl`, 'utf8');
    const manifest = JSON.parse(readFileSync(`${outDir}/manifest.json`, 'utf8'));
    assert.equal(raw.split('\n').filter(Boolean).length, 3, JSON.stringify(manifest.sources));
    assert.equal(raw.includes('census-other'), false);
    assert.equal(/hidden|cpf|email|token/.test(raw), false);
    assert.equal(manifest.sources[0].pages > 1, true);
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.globalCoverage, 'incomplete');
    assert.equal(manifest.sha256, createHash('sha256').update(raw).digest('hex'));
    const dry = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', `${outDir}/census.jsonl`, '--manifest', `${outDir}/manifest.json`, '--report', `${outDir}/dry-run.json`], { encoding: 'utf8', env: process.env });
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(readFileSync(`${outDir}/dry-run.json`, 'utf8')).censusStatus, 'complete');
    writeFileSync(`${outDir}/incomplete.json`, JSON.stringify({ ...manifest, status: 'incomplete', gaps: [{ source: 'main/users', reason: 'limit_reached' }] }), { mode: 0o600 });
    const apply = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', `${outDir}/census.jsonl`, '--manifest', `${outDir}/incomplete.json`, '--report', `${outDir}/apply.json`, '--apply-emulator'], { encoding: 'utf8', env: process.env });
    assert.notEqual(apply.status, 0);
    assert.match(apply.stderr, /censo emulador completo/);
  } finally { rmSync(outDir, { recursive: true, force: true }); }
});
test('explicit unscoped targets require tenant anchor and namespaced subject key', async () => {
  await dbAdmin.collection('users').doc('census-anchor').set({ workspaceId: 'census-w' });
  await dbAdmin.collection('users').doc('census-alien').set({ workspaceId: 'other-w' });
  await dbAdmin.collection('generatedDocuments').doc('census-linked').set({ subjectKeys: ['main.users:census-anchor'], employeeId: 'census-anchor', cpf: 'hidden' });
  await dbAdmin.collection('generatedDocuments').doc('census-unlinked').set({ employeeId: 'unknown', cpf: 'hidden' });
  await dbAdmin.collection('generatedDocuments').doc('census-legacy').set({ employeeId: 'census-anchor', cpf: 'hidden' });
  await dbAdmin.collection('generatedDocuments').doc('census-conflict').set({ subjectKeys: ['main.users:census-anchor'], employeeId: 'unknown', cpf: 'hidden' });
  await dbAdmin.collection('generatedDocuments').doc('census-alien-doc').set({ subjectKeys: ['main.users:census-alien'], cpf: 'hidden' });
  for (const [id, data] of [['census-bad-workspace1', { workspaceId: 'census-w', workspace_id: 'other-w' }], ['census-bad-workspace2', { workspaceId: 'other-w', workspace_id: 'census-w' }], ['census-bad-workspace3', { workspaceId: 'census-w', workspace_id: '' }]]) await dbAdmin.collection('generatedDocuments').doc(id).set({ ...data, subjectKeys: ['main.users:census-anchor'] });
  const root = '.ai-work/development-technology/person-traceability-20261103/census';
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const targetFile = `${root}/test-targets-${process.pid}.json`;
  writeFileSync(targetFile, JSON.stringify(['census-linked', 'census-unlinked', 'census-legacy', 'census-conflict', 'census-alien-doc', 'census-bad-workspace1', 'census-bad-workspace2', 'census-bad-workspace3'].map((id) => ({ database: 'main', collection: 'generatedDocuments', id, subject: { namespace: 'main.users', id: id === 'census-alien-doc' ? 'census-alien' : 'census-anchor' } }))), { mode: 0o600 });
  let outDir;
  try {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', PROJECT_ID, '--workspace', 'census-w', '--sources', 'main/generatedDocuments', '--targets', targetFile], { encoding: 'utf8', env: process.env });
    assert.equal(run.status, 0, run.stderr);
    outDir = JSON.parse(run.stdout.trim()).outDir;
    const raw = readFileSync(`${outDir}/census.jsonl`, 'utf8');
    const manifest = JSON.parse(readFileSync(`${outDir}/manifest.json`, 'utf8'));
    assert.equal(raw.includes('census-linked'), true, JSON.stringify(manifest.targeted));
    assert.equal(raw.includes('census-unlinked'), false);
    assert.equal(raw.includes('census-legacy'), true);
    assert.equal(raw.includes('census-conflict'), false);
    assert.equal(raw.includes('census-alien-doc'), false);
    assert.equal(raw.includes('census-bad-workspace'), false);
    assert.ok(manifest.targeted.reasons.scope_mismatch >= 3);
    assert.equal(manifest.targeted.requested, 8);
    assert.equal(manifest.targeted.accepted, 2);
    assert.equal(manifest.targeted.rejected, 6);
    assert.equal(manifest.status, 'incomplete');
  } finally { if (outDir) rmSync(outDir, { recursive: true, force: true }); rmSync(targetFile, { force: true }); }
});
const actors = [
  { uid: 'person-inventory-admin', email: 'person-inventory-admin@example.test', profile: 'person-inventory-admin-profile', admin: true },
  { uid: 'person-inventory-viewer', email: 'person-inventory-viewer@example.test', profile: 'person-inventory-viewer-profile', admin: false },
  { uid: 'person-inventory-privacy-only', email: 'person-inventory-privacy-only@example.test', profile: 'person-inventory-privacy-only-profile', admin: false, people: false },
];
async function token(actor) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: actor.email, password, returnSecureToken: true }) });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}
function request(path, idToken) { return new NextRequest(`http://localhost${path}`, { headers: { Authorization: `Bearer ${idToken}` } }); }
async function get(path, idToken) { const response = await route.GET(request(path, idToken), { params: Promise.resolve({}) }); return { status: response.status, body: await response.json() }; }
async function createRequest(idToken, subjectRef) {
  const response = await requestRoute.POST(new NextRequest('http://localhost/api/privacy/requests', { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectName: 'Titular de teste', subjectType: 'internal_user', requestType: 'access', origin: 'system', description: 'Consulta por referência explícita', subjectRef }) }), { params: Promise.resolve({}) });
  return { status: response.status, body: await response.json() };
}
test('inventory separates subject, actor and candidate linkage; enforces ACL and cursors', async (t) => {
  for (const actor of actors) {
    await authAdmin.createUser({ uid: actor.uid, email: actor.email, password });
    await authAdmin.setCustomUserClaims(actor.uid, { profileId: actor.profile, sessionVersion: 0 });
    await dbAdmin.collection('profiles').doc(actor.profile).set({ isDefaultAdmin: actor.admin, permissions: { settings: { view: true }, dp: { collaborators: { view: actor.people !== false } }, hr: { formalization: { view: true, documents: { view: true }, sensitiveData: { view: true } } } } });
    await dbAdmin.collection('users').doc(actor.uid).set({ username: actor.uid, email: actor.email, profileId: actor.profile, isActive: true, sessionVersion: 0, unitAccessScope: actor.admin ? 'all' : 'selected', unitAccessUnitIds: ['unit-a'], unitIds: ['unit-a'], profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
  const uid = 'person-inventory-subject'; const employeeId = 'person-inventory-employee'; const candidateId = 'person-inventory-candidate';
  await dbAdmin.collection('users').doc(uid).set({ username: 'Subject', hrEmployeeId: employeeId, recruitmentCandidateId: candidateId, unitIds: ['unit-a'] });
  await dbAdmin.collection('users').doc('person-inventory-other-unit').set({ username: 'Other', unitIds: ['unit-b'] });
  await hrDbAdmin.collection('employees').doc(employeeId).set({ auth_uid: uid });
  await hrDbAdmin.collection('employees').doc(employeeId).collection('consentimentos_imagem_voz_historico').doc('consent-1').set({ event: 'granted' });
  await dbAdmin.collection('dp_personScheduleIndex').doc('person-inventory-schedule-index').set({ userId: uid, competence: '2026-11', scheduleIds: ['schedule-1'] });
  await hrDbAdmin.collection('candidates').doc(candidateId).set({});
  await hrDbAdmin.collection('candidates').doc('person-inventory-foreign-candidate').set({ workspaceId: 'foreign' });
  await hrDbAdmin.collection('employees').doc('person-inventory-foreign-employee').set({ workspaceId: 'foreign' });
  await hrDbAdmin.collection('onboardingProcesses').doc('person-inventory-onboarding').set({ source: 'recruitment', candidateId, collaboratorUserId: uid });
  await hrDbAdmin.collection('hrSignatureRequests').doc('person-inventory-signature').set({ subjectKeys: [`main.users:${uid}`], signerKeys: [`main.users:${uid}`, `main.users:${actors[0].uid}`], actorKeys: [`main.users:${actors[1].uid}`], purpose: 'vacation_notice', documentStoragePath: 'hr/vacations/internal.pdf' });
  await dbAdmin.collection('generatedDocuments').doc('person-inventory-document-1').set({ subjectKeys: [`hr.candidates:${candidateId}`], generatedBy: actors[1].uid, onboardingId: 'person-inventory-onboarding', version: 1, storagePath: 'generated-documents/person-inventory-onboarding/person-inventory-document-1/document.pdf' });
  await dbAdmin.collection('generatedDocuments').doc('person-inventory-document-2').set({ subjectKeys: [`hr.candidates:${candidateId}`], generatedBy: actors[1].uid, onboardingId: 'person-inventory-onboarding', version: 2, storagePath: 'people/subject-name.pdf' });
  await dbAdmin.collection('generatedDocuments').doc('person-inventory-foreign').set({ subjectKeys: [`hr.candidates:${candidateId}`], workspaceId: 'foreign', generatedBy: actors[1].uid });
  await dbAdmin.collection('generatedDocuments').doc('person-inventory-other-unit-document').set({ subjectKeys: ['main.users:person-inventory-other-unit'], generatedBy: actors[1].uid, unitId: 'unit-b' });
  await hrDbAdmin.collection('employeeDocuments').doc('person-inventory-health-document').set({ subjectKeys: [`main.users:${uid}`], accessPolicyId: 'HEALTH', employeeId, storagePath: 'hr/employee-documents/secret.pdf' });
  await financialDbAdmin.collection('bankPaymentRequests').doc('person-inventory-entity-payment').set({ sourceType: 'vacation', beneficiaryReference: { sourceType: 'entity', sourceId: employeeId }, workspaceId: 'coala' });
  await financialDbAdmin.collection('bankPaymentRequests').doc('person-inventory-vacation-payment').set({ sourceType: 'vacation', beneficiaryReference: { sourceType: 'employee', sourceId: employeeId }, workspaceId: 'coala' });
  await financialDbAdmin.collection('bankPaymentRequests').doc('person-inventory-salary-payment').set({ sourceType: 'salary', beneficiaryReference: { sourceType: 'employee', sourceId: employeeId }, workspaceId: 'coala' });
  await financialDbAdmin.collection('bankPaymentRequests').doc('person-inventory-termination-payment').set({ sourceType: 'termination', beneficiaryReference: { sourceType: 'employee', sourceId: uid }, workspaceId: 'coala' });
  await financialDbAdmin.collection('expenses').doc('person-inventory-vacation-expense').set({ sourceType: 'vacation', employeeId, workspaceId: 'coala' });
  await financialDbAdmin.collection('expenses').doc('person-inventory-other-expense').set({ sourceType: 'other', employeeId, workspaceId: 'coala' });
  t.after(async () => {
    for (const collection of ['generatedDocuments', 'users', 'profiles']) {
      const ids = collection === 'generatedDocuments' ? ['person-inventory-document-1', 'person-inventory-document-2', 'person-inventory-foreign', 'person-inventory-other-unit-document'] : collection === 'users' ? [uid, 'person-inventory-foreign-user', 'person-inventory-other-unit', ...actors.map((actor) => actor.uid)] : actors.map((actor) => actor.profile);
      await Promise.all(ids.map((id) => dbAdmin.collection(collection).doc(id).delete()));
    }
    await Promise.all([hrDbAdmin.collection('employees').doc(employeeId).delete(), hrDbAdmin.collection('candidates').doc(candidateId).delete(), hrDbAdmin.collection('onboardingProcesses').doc('person-inventory-onboarding').delete(), hrDbAdmin.collection('onboardingProcesses').doc('person-inventory-collision').delete()]);
    await Promise.all([hrDbAdmin.collection('candidates').doc('person-inventory-foreign-candidate').delete(), hrDbAdmin.collection('employees').doc('person-inventory-foreign-employee').delete(), hrDbAdmin.collection('candidates').doc('person-inventory-cross-candidate').delete(), hrDbAdmin.collection('onboardingProcesses').doc('person-inventory-cross-process').delete(), dbAdmin.collection('users').doc('person-inventory-cross-user').delete()]);
    await Promise.all([hrDbAdmin.collection('employees').doc(employeeId).collection('consentimentos_imagem_voz_historico').doc('consent-1').delete(), dbAdmin.collection('dp_personScheduleIndex').doc('person-inventory-schedule-index').delete()]);
    await Promise.all(['person-inventory-entity-payment', 'person-inventory-vacation-payment', 'person-inventory-salary-payment', 'person-inventory-termination-payment'].map((id) => financialDbAdmin.collection('bankPaymentRequests').doc(id).delete()));
    await Promise.all(['person-inventory-vacation-expense', 'person-inventory-other-expense'].map((id) => financialDbAdmin.collection('expenses').doc(id).delete()));
    await hrDbAdmin.collection('employeeDocuments').doc('person-inventory-health-document').delete();
    await hrDbAdmin.collection('hrSignatureRequests').doc('person-inventory-signature').delete();
    await Promise.all(actors.map((actor) => authAdmin.deleteUser(actor.uid)));
  });
  const admin = await token(actors[0]); const viewer = await token(actors[1]);
  const privacyOnly = await token(actors[2]);
  const governance = await requestRoute.GET(request('/api/privacy/requests', privacyOnly), { params: Promise.resolve({}) });
  assert.equal(governance.status, 200);
  for (const id of [uid, 'person-inventory-missing']) {
    const denied = await get(`/api/privacy/person-inventory?namespace=main.users&id=${id}`, privacyOnly);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error?.code, 'PERSON_ANCHOR_FORBIDDEN');
    assert.equal(JSON.stringify(denied.body).includes('equivalents'), false);
  }
  const catalog = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}`, admin);
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.equivalents.some((ref) => ref.namespace === 'hr.candidates' && ref.id === candidateId));
  const fromHr = await get(`/api/privacy/person-inventory?namespace=hr.employees&id=${employeeId}`, admin);
  const fromCandidate = await get(`/api/privacy/person-inventory?namespace=hr.candidates&id=${candidateId}`, admin);
  for (const result of [fromHr, fromCandidate]) assert.deepEqual(new Set(result.body.equivalents.map((ref) => `${ref.namespace}:${ref.id}`)), new Set(catalog.body.equivalents.map((ref) => `${ref.namespace}:${ref.id}`)));
  const first = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=generated-documents&limit=1`, admin);
  assert.equal(first.status, 200); assert.equal(first.body.items.length, 1); assert.equal(first.body.status, 'partial');
  assert.equal(first.body.items[0].role, 'subject'); assert.equal(first.body.items[0].version, 1);
  assert.ok(first.body.nextCursor);
  const second = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=generated-documents&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, admin);
  assert.equal(second.status, 200); assert.equal(second.body.items[0].id, 'person-inventory-document-2');
  assert.deepEqual(second.body.items[0].storageReferences, [{ field: 'storagePath', path: null, available: true }]);
  assert.equal(second.body.items.some((item) => item.id === 'person-inventory-foreign'), false);
  const third = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=generated-documents&limit=1&cursor=${encodeURIComponent(second.body.nextCursor)}`, admin);
  assert.equal(third.status, 200); assert.deepEqual(third.body.items, []); assert.equal(third.body.nextCursor, null);
  const badCursor = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=employee-documents&cursor=${encodeURIComponent(first.body.nextCursor)}`, admin);
  assert.equal(badCursor.status, 400);
  const actorItems = await get(`/api/privacy/person-inventory?namespace=main.users&id=${actors[1].uid}&source=generated-document-actors`, admin);
  assert.equal(actorItems.status, 200); assert.ok(actorItems.body.items.some((item) => item.role === 'actor' && item.id === 'person-inventory-document-1'));
  for (const [source, personId, role] of [['signature-requests', uid, 'subject'], ['signature-signers', actors[0].uid, 'signer'], ['signature-actors', actors[1].uid, 'actor']]) {
    const result = await get(`/api/privacy/person-inventory?namespace=main.users&id=${personId}&source=${source}`, admin);
    assert.equal(result.status, 200); assert.ok(result.body.items.some((item) => item.id === 'person-inventory-signature' && item.role === role));
  }
  const signatureRestricted = await get(`/api/privacy/person-inventory?namespace=main.users&id=${actors[1].uid}&source=signature-actors`, viewer);
  assert.equal(signatureRestricted.body.status, 'restricted'); assert.deepEqual(signatureRestricted.body.items, []);
  const restricted = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=generated-documents`, viewer);
  assert.equal(restricted.status, 200); assert.equal(restricted.body.status, 'restricted'); assert.deepEqual(restricted.body.items, []);
  const restrictedHealth = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=employee-documents`, viewer);
  assert.equal(restrictedHealth.body.status, 'restricted'); assert.equal(JSON.stringify(restrictedHealth.body).includes('secret.pdf'), false);
  const actorOtherUnit = await get(`/api/privacy/person-inventory?namespace=main.users&id=${actors[1].uid}&source=generated-document-actors`, viewer);
  assert.equal(actorOtherUnit.body.status, 'restricted'); assert.equal(JSON.stringify(actorOtherUnit.body).includes('person-inventory-other-unit-document'), false);
  const restrictedFinance = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=financial-vacation-payments`, viewer);
  assert.equal(restrictedFinance.body.status, 'restricted'); assert.deepEqual(Object.keys(restrictedFinance.body.source), ['id']);
  for (const [source, expected] of [['financial-vacation-payments', 'person-inventory-vacation-payment'], ['financial-salary-payments', 'person-inventory-salary-payment'], ['financial-termination-payments', 'person-inventory-termination-payment']]) {
    const finance = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=${source}`, admin);
    assert.equal(finance.status, 200); assert.deepEqual(finance.body.items.map((item) => item.id), [expected]);
  }
  const financeFromHr = await get(`/api/privacy/person-inventory?namespace=hr.employees&id=${employeeId}&source=financial-termination-payments`, admin);
  assert.deepEqual(financeFromHr.body.items.map((item) => item.id), ['person-inventory-termination-payment']);
  const vacationExpense = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=financial-vacation-expenses`, admin);
  assert.deepEqual(vacationExpense.body.items.map((item) => item.id), ['person-inventory-vacation-expense']);
  const consents = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=image-voice-consents`, admin);
  assert.equal(consents.status, 200); assert.equal(consents.body.items[0].recordPath, `employees/${employeeId}/consentimentos_imagem_voz_historico/consent-1`);
  const schedules = await get(`/api/privacy/person-inventory?namespace=main.users&id=${uid}&source=schedule-index`, admin);
  assert.equal(schedules.status, 200); assert.deepEqual(schedules.body.items.map((item) => item.id), ['person-inventory-schedule-index']);
  await dbAdmin.collection('users').doc('person-inventory-foreign-user').set({ workspaceId: 'foreign', unitAccessScope: 'all' });
  const foreignTarget = await get('/api/privacy/person-inventory?namespace=main.users&id=person-inventory-foreign-user', admin);
  assert.equal(foreignTarget.status, 403);
  const linkedRequest = await createRequest(admin, { namespace: 'main.users', id: uid });
  assert.equal(linkedRequest.status, 201);
  assert.deepEqual(linkedRequest.body.request.subjectRef, { namespace: 'main.users', id: uid });
  const storedRequest = await dbAdmin.collection('privacyRequests').doc(linkedRequest.body.request.id).get();
  assert.ok(storedRequest.get('subjectKeys').includes(`main.users:${uid}`));
  const foreignRequest = await createRequest(admin, { namespace: 'main.users', id: 'person-inventory-foreign-user' });
  assert.equal(foreignRequest.status, 403);
  const missingRequest = await createRequest(admin, { namespace: 'main.users', id: 'person-inventory-missing' });
  assert.equal(missingRequest.status, 400);
  assert.equal((await get('/api/privacy/person-inventory?namespace=hr.candidates&id=person-inventory-foreign-candidate', admin)).status, 403);
  assert.equal((await get('/api/privacy/person-inventory?namespace=hr.employees&id=person-inventory-foreign-employee', admin)).status, 403);
  await hrDbAdmin.collection('candidates').doc('person-inventory-cross-candidate').set({ workspaceId: 'coala' });
  await dbAdmin.collection('users').doc('person-inventory-cross-user').set({ recruitmentCandidateId: 'person-inventory-cross-candidate', unitIds: ['unit-a'] });
  await hrDbAdmin.collection('onboardingProcesses').doc('person-inventory-cross-process').set({ source: 'recruitment', candidateId: 'person-inventory-cross-candidate', collaboratorUserId: 'person-inventory-cross-user', workspaceId: 'foreign' });
  assert.equal((await get('/api/privacy/person-inventory?namespace=main.users&id=person-inventory-cross-user', admin)).status, 403);
  const actorContext = await requireUser(request('/api/privacy/person-inventory', admin));
  const failed = await collectPersonSource({ actor: actorContext, sourceId: 'generated-documents', ref: { namespace: 'main.users', id: uid }, limit: 1, sourceDb: { collection() { throw new Error('private token in backend error'); } } });
  assert.equal(failed.status, 'failed'); assert.equal(JSON.stringify(failed).includes('private token'), false);
  await hrDbAdmin.collection('onboardingProcesses').doc('person-inventory-collision').set({ source: 'recruitment', candidateId, collaboratorUserId: actors[1].uid });
  const collision = await get(`/api/privacy/person-inventory?namespace=hr.candidates&id=${candidateId}`, admin);
  assert.equal(collision.status, 200); assert.deepEqual(collision.body.equivalents, [{ namespace: 'hr.candidates', id: candidateId }]); assert.ok(collision.body.conflicts.includes('candidate_user_collision'));
  assert.equal((await createRequest(admin, { namespace: 'hr.candidates', id: candidateId })).status, 400);
});

test('native row scopes deny B/history A+B, require express location/admin and payment permission, journey exists only in HR', async (t) => {
  const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
  const uid = 'review-native-subject';
  const userRef = dbAdmin.collection('users').doc(uid);
  await userRef.set({ workspaceId: 'coala', unitIds: ['A'] });
  const actor = { decoded: { uid: 'review-staff' }, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['A'] }, isDefaultAdmin: false, workspace_id: 'coala', permissions: { dp: { view: true, collaborators: { view: true }, timeRecording: { view: true, readLocation: true } }, financial: { view: true, personnelCosts: { view: true } } } };
  const records = [];
  const put = async (db, collection, id, value) => { const ref = db.collection(collection).doc(id); records.push(ref); await ref.set({ workspaceId: 'coala', employeeId: uid, employeeUid: uid, ...value }); };
  t.after(async () => { await Promise.all([userRef, ...records].map((ref) => ref.delete())); });
  await put(repPDbAdmin, 'repP_receipts', 'review-native-a', { snapshot: { executionUnitId: 'A' } });
  await put(repPDbAdmin, 'repP_receipts', 'review-native-b', { snapshot: { executionUnitId: 'B' }, unitId: 'A' });
  await put(repPDbAdmin, 'repP_receipts', 'review-native-missing', { unitId: 'A' });
  await put(hrDbAdmin, 'repP_pilotMarkings', 'review-native-pilot-b', { executionUnitId: 'B', unitId: 'A' });
  await put(hrDbAdmin, 'ptrp_adjustmentRequests', 'review-native-adjustment-ab', { unitId: 'A', unitIds: ['A', 'B'] });
  await put(hrDbAdmin, 'ptrp_adjustmentRequests', 'review-native-adjustment-a', { unitIds: ['A'] });
  await put(hrDbAdmin, 'dp_journeyLocationEvents', 'review-native-journey-a', { executionUnitId: 'A' });
  const read = (sourceId, context = actor) => collectPersonSource({ actor: context, sourceId, ref: { namespace: 'main.users', id: uid }, limit: 50 });
  assert.deepEqual((await read('rep-p-receipts')).items.map((row) => row.id), ['review-native-a']);
  assert.deepEqual((await read('rep-p-pilot-markings')).items, []);
  assert.deepEqual((await read('rep-p-adjustments')).items.map((row) => row.id), ['review-native-adjustment-a']);
  assert.deepEqual((await read('rep-p-journey-location')).items.map((row) => row.id), ['review-native-journey-a']);
  assert.equal((await read('rep-p-journey-location', { ...actor, isDefaultAdmin: true, permissions: { dp: { collaborators: { view: true } } } })).status, 'restricted');
  assert.equal((await read('financial-vacation-payments')).status, 'restricted');
  // Both contradictory field orders on record and anchor must deny even administrators.
  for (const [workspaceId, workspace_id] of [['coala', 'other'], ['other', 'coala']]) {
    await userRef.set({ workspaceId, workspace_id, unitIds: ['A'] });
    await assert.rejects(read('rep-p-receipts', { ...actor, isDefaultAdmin: true }), { code: 'PERSON_WORKSPACE_FORBIDDEN' });
  }
});

test('opaque continuations advance across denied batches/budget without disclosing IDs, recheck bindings and survive deletion', async (t) => {
  const { Timestamp } = await import('firebase-admin/firestore');
  const uid = 'residual-page-subject'; const other = 'residual-page-other';
  const actor = { decoded: { uid: 'residual-operator' }, authenticatedActor: { uid: 'residual-real-operator' }, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['A'] }, isDefaultAdmin: false, workspace_id: 'coala', permissions: { dp: { collaborators: { view: true }, timeRecording: { view: true } } } };
  const ref = { namespace: 'main.users', id: uid };
  const rows = []; const cache = [];
  const user = dbAdmin.collection('users').doc(uid); const second = dbAdmin.collection('users').doc(other);
  await user.set({ unitIds: ['A'] }); await second.set({ unitIds: ['A'] });
  t.after(async () => { await Promise.all([user, second, ...rows, ...cache].map((r) => r.delete())); });
  const put = async (id, unitIds) => { const r = hrDbAdmin.collection('ptrp_adjustmentRequests').doc(id); rows.push(r); await r.set({ workspaceId: 'coala', employeeUid: uid, unitIds }); };
  const read = (cursor, extra = {}) => collectPersonSource({ actor, sourceId: 'rep-p-adjustments', ref, limit: 2, ...(cursor ? { cursor } : {}), ...extra });
  for (const [id, units] of [['residual-0-allowA', ['A']], ['residual-1-DENIED-B', ['A', 'B']], ['residual-2-allowC', ['A']], ['residual-3-DENIED-D', ['B']], ['residual-4-allowE', ['A']]]) await put(id, units);
  const first = await read(); assert.deepEqual(first.items.map((x) => x.id), ['residual-0-allowA', 'residual-2-allowC']);
  assert.match(first.nextCursor, /^pc1_[A-Za-z0-9_-]{43}$/); cache.push(dbAdmin.collection('privacyPersonCursorStates').doc(first.nextCursor));
  assert.equal(JSON.stringify(first).includes('DENIED'), false);
  assert.equal(Buffer.from(first.nextCursor, 'base64url').toString().includes('DENIED'), false);
  for (const extra of [{ actor: { ...actor, authenticatedActor: { uid: 'different-real' } } }, { actor: { ...actor, viewAs: { targetUserId: 'different-view-as', readOnly: true } } }, { ref: { namespace: 'main.users', id: other } }, { sourceId: 'rep-p-pilot-adjustments' }, { limit: 3 }]) await assert.rejects(read(first.nextCursor, extra), { code: 'PERSON_CURSOR_INVALID' });
  const failedSource = { collection() { return { where() { throw new Error('simulated transient source failure'); } }; } };
  const failedPage = await read(first.nextCursor, { sourceDb: failedSource });
  assert.equal(failedPage.status, 'failed');
  assert.equal(JSON.stringify(failedPage).includes('simulated transient'), false);
  const secondPage = await read(first.nextCursor); assert.deepEqual(secondPage.items.map((x) => x.id), ['residual-4-allowE']); assert.equal(secondPage.nextCursor, null);
  // A response can be lost after success. Reusing its input must remain a safe GET retry.
  assert.deepEqual((await read(first.nextCursor)).items, secondPage.items);
  const revoked = await read(first.nextCursor, { actor: { ...actor, permissions: { dp: { collaborators: { view: true }, timeRecording: { view: false } } } } });
  assert.equal(revoked.status, 'restricted'); assert.deepEqual(revoked.items, []);
  assert.deepEqual((await read(first.nextCursor)).items, secondPage.items);
  await assert.rejects(read(Buffer.from(JSON.stringify({ id: 'DENIED-B' })).toString('base64url')), { code: 'PERSON_CURSOR_INVALID' });
  for (const r of rows) await r.delete(); rows.length = 0;
  for (let i = 0; i < 101; i++) await put(`residual-prefix-DENIED-${String(i).padStart(3, '0')}`, ['A', 'B']);
  await put('residual-z-allowed-after-budget', ['A']);
  const empty = await read(); assert.equal(empty.items.length, 0); assert.equal(empty.status, 'partial'); assert.ok(empty.nextCursor); assert.equal(JSON.stringify(empty).includes('DENIED'), false);
  const position = dbAdmin.collection('privacyPersonCursorStates').doc(empty.nextCursor); cache.push(position);
  const privateState = await position.get(); assert.equal(privateState.get('position'), 'residual-prefix-DENIED-099');
  await hrDbAdmin.collection('ptrp_adjustmentRequests').doc(privateState.get('position')).delete();
  const afterBudget = await read(empty.nextCursor); assert.deepEqual(afterBudget.items.map((x) => x.id), ['residual-z-allowed-after-budget']); assert.equal(afterBudget.nextCursor, null);
  const expiring = await read(); assert.ok(expiring.nextCursor); const expiry = dbAdmin.collection('privacyPersonCursorStates').doc(expiring.nextCursor); cache.push(expiry);
  await expiry.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
  await assert.rejects(read(expiring.nextCursor), { code: 'PERSON_CURSOR_INVALID' });
});

test('asset current/legacy/former/received references use native holder types and history grants; offline cycles need no invented unit', async (t) => {
  const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
  const uid = 'residual-asset-person'; const user = dbAdmin.collection('users').doc(uid);
  await user.set({ unitIds: ['A'] });
  const actor = { decoded: { uid: 'asset-reader' }, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['A'] }, isDefaultAdmin: false, workspace_id: 'coala', permissions: { dp: { collaborators: { view: true }, timeRecording: { view: true }, vacation: { viewAll: true } }, assets: { view: true, viewHistory: true } } };
  const refs = [user];
  const put = async (db, collection, id, data) => { const r = db.collection(collection).doc(id); refs.push(r); await r.set({ workspaceId: 'coala', ...data }); };
  t.after(async () => { await Promise.all(refs.map((r) => r.delete())); });
  await put(dbAdmin, 'assets', 'residual-asset-current', { custody: { holderType: 'employee', holderId: uid } });
  await put(dbAdmin, 'assets', 'residual-asset-company', { custody: { holderType: 'company', holderId: uid } });
  await put(dbAdmin, 'assets', 'residual-asset-third', { custody: { holderType: 'third_party', holderId: uid } });
  await put(dbAdmin, 'assets', 'residual-asset-legacy', { responsibleUserId: uid, custody: { holderType: 'employee', holderId: 'other-person' } });
  await put(dbAdmin, 'assetCustodyTransfers', 'residual-transfer', { fromHolder: { holderType: 'employee', holderId: uid }, toHolder: { holderType: 'employee', holderId: uid } });
  await put(repPDbAdmin, 'repP_offlineCycles', 'residual-offline-realshape', { employeeId: uid, cycleId: 'cycle', permitId: 'permit', startedAtMs: Date.now(), expiresAtMs: Date.now() + 10000, startedElapsedRealtimeMs: 1, lastReceiptId: 'receipt', status: 'active' });
  const read = (sourceId, selectedActor = actor) => collectPersonSource({ actor: selectedActor, sourceId, ref: { namespace: 'main.users', id: uid }, limit: 25 });
  assert.deepEqual((await read('asset-current-custody')).items.map((x) => x.id), ['residual-asset-current']);
  const legacy = await read('asset-legacy-responsible'); assert.equal(legacy.items[0].role, 'participant'); assert.equal(legacy.items[0].id, 'residual-asset-legacy');
  assert.deepEqual((await read('asset-former-custody')).items.map((x) => x.id), ['residual-transfer']);
  assert.deepEqual((await read('asset-custody')).items.map((x) => x.id), ['residual-transfer']);
  assert.equal((await read('asset-custody', { ...actor, permissions: { ...actor.permissions, assets: { view: true, viewHistory: false } } })).status, 'restricted');
  assert.deepEqual((await read('rep-p-offline-cycles')).items.map((x) => x.id), ['residual-offline-realshape']);
  await put(dbAdmin, 'dp_vacations', 'residual-vacation-native-shape', { userId: uid, status: 'draft', workflow: {}, createdBy: actor.decoded.uid, startDate: '2026-12-01', endDate: '2026-12-10' });
  assert.deepEqual((await read('vacations')).items.map((x) => x.id), ['residual-vacation-native-shape']);
  const foreign = dbAdmin.collection('users').doc('residual-vacation-foreign-person'); refs.push(foreign); await foreign.set({ unitIds: ['B'] });
  await assert.rejects(collectPersonSource({ actor, sourceId: 'vacations', ref: { namespace: 'main.users', id: foreign.id }, limit: 25 }), { code: 'PERSON_UNIT_FORBIDDEN' });

  const admin = { ...actor, isDefaultAdmin: true };
  assert.equal((await read('inventory-cursor-subjects', admin)).status, 'restricted');
});

test('document census refuses the process sentinel without exporting a row or proposing a patch', async (t) => {
  const privateSource = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', PROJECT_ID, '--workspace', 'coala', '--sources', 'main/privacyPersonCursorStates'], { encoding: 'utf8', env: process.env });
  assert.notEqual(privateSource.status, 0); assert.match(privateSource.stderr, /Fonte não cadastrada/);
  const root = '.ai-work/development-technology/person-traceability-20261103/census'; mkdirSync(root, { recursive: true, mode: 0o700 });
  const targetFile = `${root}/residual-process-target-${process.pid}.json`; const refs = []; const outputs = [];
  t.after(async () => { await Promise.all(refs.map((r) => r.delete())); rmSync(targetFile, { force: true }); for (const out of outputs) rmSync(out, { recursive: true, force: true }); });
  for (const total of [21, 22]) {
    const uid = `residual-census-u-${total}`, cid = `residual-census-c-${total}`, did = `residual-census-doc-${total}`;
    const user = dbAdmin.collection('users').doc(uid), candidate = hrDbAdmin.collection('candidates').doc(cid), document = dbAdmin.collection('generatedDocuments').doc(did); refs.push(user, candidate, document);
    await user.set({ workspaceId: 'coala', recruitmentCandidateId: cid }); await candidate.set({ workspaceId: 'coala' }); await document.set({ employeeId: uid });
    for (let i = 0; i < total; i++) { const p = hrDbAdmin.collection('onboardingProcesses').doc(`residual-census-process-${total}-${String(i).padStart(2, '0')}`); refs.push(p); await p.set({ workspaceId: 'coala', candidateId: cid, collaboratorUserId: i === 21 ? 'hidden-different-user' : uid }); }
    writeFileSync(targetFile, JSON.stringify([{ database: 'main', collection: 'generatedDocuments', id: did, subject: { namespace: 'main.users', id: uid } }]), { mode: 0o600 });
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', PROJECT_ID, '--workspace', 'coala', '--sources', 'main/generatedDocuments', '--targets', targetFile], { encoding: 'utf8', env: process.env }); assert.equal(run.status, 0, run.stderr);
    const { outDir } = JSON.parse(run.stdout.trim()); outputs.push(outDir);
    const manifest = JSON.parse(readFileSync(`${outDir}/manifest.json`, 'utf8')); const raw = readFileSync(`${outDir}/census.jsonl`, 'utf8');
    assert.equal(manifest.status, 'incomplete'); assert.equal(manifest.targeted.reasons.process_limit, 1); assert.equal(raw.includes(did), false); assert.equal(JSON.stringify(manifest.targeted.reasons).includes(uid), false);
    const dry = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', `${outDir}/census.jsonl`, '--manifest', `${outDir}/manifest.json`, '--report', `${outDir}/dry.json`], { encoding: 'utf8', env: process.env }); assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(readFileSync(`${outDir}/dry.json`, 'utf8')).patches, []);
  }
});

test('native remaining source shapes use beneficiary domain, execution fields or receipt parent instead of invented unitId', async (t) => {
  const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
  const uid = 'residual-native-shapes'; const user = dbAdmin.collection('users').doc(uid);
  await user.set({ unitIds: ['A'] });
  const actor = { decoded: { uid: 'native-shapes-reader' }, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['A'] }, isDefaultAdmin: false, workspace_id: 'coala', permissions: { dp: { collaborators: { view: true }, requests: { view: true }, timeRecording: { view: true } }, stock: { uniforms: { view: true } }, hr: { formalization: { onboarding: { manage: true }, consents: { view: false, manage: false } } } } };
  const refs = [user];
  const put = async (db, collection, id, data) => { const r = db.collection(collection).doc(id); refs.push(r); await r.set({ workspaceId: 'coala', ...data }); };
  t.after(async () => { await Promise.all(refs.map((r) => r.delete())); });
  await put(dbAdmin, 'collaboratorRequests', 'residual-native-request', { employeeId: uid, unitId: null, unitIds: ['A'], type: 'transport_voucher', status: 'pending' });
  await put(dbAdmin, 'uniformAssignments', 'residual-native-uniform', { collaboratorUserId: uid, quantityInPossession: 1, status: 'active' });
  await put(hrDbAdmin, 'hrProfileUpdateRequests', 'residual-native-profile', { employeeId: uid, subjectKeys: [`main.users:${uid}`], type: 'integration_profile_update', status: 'pending_confirmation' });
  for (const unit of ['A', 'B']) {
    await put(hrDbAdmin, 'ptrp_treatments', `residual-native-treatment-${unit}`, { employeeUid: uid, type: 'inclusion', executionUnitId: unit, status: 'active' });
    const receiptId = `residual-native-classification-${unit}`;
    await put(repPDbAdmin, 'repP_receipts', receiptId, { employeeId: uid, snapshot: { executionUnitId: unit } });
    await put(hrDbAdmin, 'ptrp_markingClassifications', receiptId, { employeeId: uid, receiptId, classification: { purpose: 'shift_entry', source: 'reviewed', status: 'confirmed' } });
  }
  for (const [suffix, parent] of [['missing', null], ['foreign-person', { employeeId: 'different-person' }], ['foreign-workspace', { employeeId: uid, workspaceId: 'other' }]]) {
    const id = `residual-native-classification-${suffix}`;
    if (parent) await put(repPDbAdmin, 'repP_receipts', id, { snapshot: { executionUnitId: 'A' }, ...parent });
    await put(hrDbAdmin, 'ptrp_markingClassifications', id, { employeeId: uid, receiptId: id, classification: { purpose: 'shift_entry' } });
  }
  const read = (sourceId) => collectPersonSource({ actor, sourceId, ref: { namespace: 'main.users', id: uid }, limit: 25 });
  assert.equal((await read('rep-p-classifications')).status, 'partial');
  for (const [sourceId, expected] of [['collaborator-requests','residual-native-request'],['uniform-assignments','residual-native-uniform'],['integrations','residual-native-profile'],['rep-p-treatments','residual-native-treatment-A'],['rep-p-classifications','residual-native-classification-A']]) assert.deepEqual((await read(sourceId)).items.map((x) => x.id), [expected], sourceId);
});

test('candidate inventory ignores native manual/PJ aliases and unknown origin before admin bypass', async (t) => {
  const { canViewPersonRecord } = await import('../../src/features/privacy/person-inventory.server.ts');
  const { sourceById } = await import('../../src/features/privacy/person-inventory.ts');
  const { resolveStrictPersonRefs } = await import('../../src/features/privacy/person-subject.ts');
  const { firestorePersonLookup } = await import('../../src/features/privacy/person-lookup.server.ts');
  const actor = { decoded: { uid: 'candidate-alias-admin' }, userDoc: {}, permissions: {}, isDefaultAdmin: true, workspace_id: 'coala' };
  const refs = []; t.after(async () => { await Promise.all(refs.map((ref) => ref.firestore.recursiveDelete(ref))); });
  const nativeBase = { source: 'manual', applicationId: null, jobOpeningId: null, employmentRelationshipType: 'clt', jobRoleId: 'role', functionId: 'function', unitId: 'unit', employerUnitId: 'unit', integrationV2: { snapshot: { schemaVersion: 'coala-integration-v1' } } };
  for (const kind of ['manual', 'pj', 'unknown']) {
    const pid = `candidate-alias-${kind}`, cid = `${kind === 'pj' ? 'pj' : 'manual'}_${pid}`, uid = `candidate-alias-user-${kind}`, hrId = `candidate-alias-hr-${kind}`;
    const candidate = hrDbAdmin.collection('candidates').doc(cid), processRef = hrDbAdmin.collection('onboardingProcesses').doc(pid), user = dbAdmin.collection('users').doc(uid), employee = hrDbAdmin.collection('employees').doc(hrId); refs.push(candidate, processRef, user, employee);
    await candidate.set({ workspaceId: 'coala' }); await user.set({ workspaceId: 'coala', source: 'recruitment_onboarding', onboardingId: pid, recruitmentCandidateId: cid, hrEmployeeId: hrId }); await employee.set({ workspaceId: 'coala', auth_uid: uid });
    const data = { ...nativeBase, candidateId: cid, collaboratorUserId: uid, employeeId: uid, workspaceId: 'coala', ...(kind === 'pj' ? { employmentRelationshipType: 'pj', providerCnpj: '11444777000161', pjWorkflow: { version: 1, provider: { cnpj: '11444777000161' } } } : {}), ...(kind === 'unknown' ? { source: 'unknown' } : {}) };
    await processRef.set(data); assert.equal(canViewPersonRecord(actor, sourceById('onboarding-candidates'), { ...data, id: pid }), false);
    const anchor = { namespace: 'hr.candidates', id: cid };
    const collected = await collectPersonSource({ actor, sourceId: 'onboarding-candidates', ref: anchor, limit: 25 });
    assert.equal(collected.items.length, 0); assert.equal(JSON.stringify(collected).includes(pid), false);
    if (kind !== 'unknown') {
      assert.deepEqual((await resolveStrictPersonRefs({ namespace: 'main.users', id: uid }, firestorePersonLookup)).refs.map((ref) => ref.namespace).sort(), ['hr.employees', 'main.users']);
      assert.deepEqual((await resolveStrictPersonRefs(anchor, firestorePersonLookup)).refs, [anchor]);
    } else assert.ok(collected.conflicts.includes('candidate_process_origin_unconfirmed'));
  }
  const cid = 'candidate-real-recruitment', pid = 'candidate-real-process', uid = 'candidate-real-user', hrId = 'candidate-real-hr';
  const candidate = hrDbAdmin.collection('candidates').doc(cid), processRef = hrDbAdmin.collection('onboardingProcesses').doc(pid), user = dbAdmin.collection('users').doc(uid), employee = hrDbAdmin.collection('employees').doc(hrId); refs.push(candidate, processRef, user, employee);
  await candidate.set({ workspaceId: 'coala' }); await user.set({ workspaceId: 'coala', hrEmployeeId: hrId, recruitmentCandidateId: cid }); await employee.set({ workspaceId: 'coala', auth_uid: uid }); await processRef.set({ source: 'recruitment', candidateId: cid, collaboratorUserId: uid, workspaceId: 'coala' });
  const collected = await collectPersonSource({ actor, sourceId: 'onboarding-candidates', ref: { namespace: 'hr.candidates', id: cid }, limit: 25 });
  assert.deepEqual(collected.items.map((item) => item.id), [pid]);
  assert.deepEqual(new Set((await resolveStrictPersonRefs({ namespace: 'hr.candidates', id: cid }, firestorePersonLookup)).refs.map((ref) => ref.namespace)), new Set(['main.users', 'hr.employees', 'hr.candidates']));
});
