import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { getStorage } from 'firebase-admin/storage';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
process.env.RESEND_API_KEY = 'synthetic-email-provider'; process.env.AUTENTIQUE_API_TOKEN = 'synthetic-signature-provider';
process.env.BIZNEO_TOKEN = 'synthetic-bizneo'; process.env.DOCX_TO_PDF_URL = 'http://127.0.0.1:7999/forms/libreoffice/convert';
delete process.env.DOCX_TO_PDF_AUDIENCE; delete process.env.DOCX_TO_PDF_ID_TOKEN;
const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
const originalFetch = globalThis.fetch; let fakeSends = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://api.resend.com/emails') return Response.json({ id: 'fake-email' });
  if (url === 'https://api.autentique.com.br/v2/graphql') { fakeSends++; return Response.json({ data: { createDocument: { id: `fake-signature-${fakeSends}`, created_at: '2026-11-03T00:00:00Z', signatures: [] } } }); }
  if (url.startsWith('https://coala.bizneohr.com/api/v1/')) return Response.json({ data: [], employees: [], users: [] });
  if (url === process.env.DOCX_TO_PDF_URL) return new Response(bytes, { headers: { 'content-type': 'application/pdf' } });
  if (/^http:\/\/(localhost|127\.0\.0\.1):/.test(url)) return originalFetch(input, init);
  throw new Error('Unexpected external network denied in native admission witness');
};
const { authAdmin, dbAdmin, adminApp } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const intake = await import('../../src/app/api/hr/onboarding/route.ts');
const account = await import('../../src/app/api/hr/onboarding/[id]/route.ts');
const pj = await import('../../src/app/api/hr/onboarding/[id]/pj-workflow/route.ts');
const { generateDocumentFromTemplate } = await import('../../src/features/hr/documents/generate-document.server.ts');
const { sendGeneratedDocumentForStandaloneSignature } = await import('../../src/features/hr/documents/signature-workflow.server.ts');
const { confirmedSubjectKeys, confirmedSubjectKeysForDocument } = await import('../../src/features/privacy/person-lookup.server.ts');
const { collectPersonSource } = await import('../../src/features/privacy/person-inventory.server.ts');
const { resolveStrictPersonRefs } = await import('../../src/features/privacy/person-subject.ts');
const { firestorePersonLookup } = await import('../../src/features/privacy/person-lookup.server.ts');
const { prepareOnboardingPersonForWrite } = await import('../../src/features/privacy/onboarding-person.server.ts');
const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const actorId = 'native-admission-operator', profileId = 'native-admission-admin-profile', roleId = 'native-admission-role', functionId = 'native-admission-function', unitId = 'native-admission-unit';
let token;
function req(path, body) { return new NextRequest(`http://localhost${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
async function patch(id, body) { const request = new NextRequest(`http://localhost/api/hr/onboarding/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const response = await account.PATCH(request, { params: Promise.resolve({ id }) }); return { status: response.status, body: await response.json() }; }
const actor = { decoded: { uid: actorId }, userDoc: {}, isDefaultAdmin: true, workspace_id: 'coala', permissions: {} };
test.before(async () => {
  await authAdmin.createUser({ uid: actorId, email: `${actorId}@example.test`, password: 'synthetic-emulator-password' });
  await authAdmin.setCustomUserClaims(actorId, { profileId, sessionVersion: 0 });
  await dbAdmin.collection('profiles').doc(profileId).set({ isDefaultAdmin: true, permissions: {} });
  await dbAdmin.collection('users').doc(actorId).set({ username: actorId, profileId, isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 } });
  await dbAdmin.collection('profiles').doc('native-admission-worker-profile').set({ name: 'Worker', permissions: {} });
  await hrDbAdmin.collection('jobRoles').doc(roleId).set({ name: 'Synthetic role', defaultProfileId: 'native-admission-worker-profile', cbo: '521110', onboardingDocuments: [] });
  await hrDbAdmin.collection('jobFunctions').doc(functionId).set({ name: 'Synthetic function', compatibleRoleIds: [roleId], salaryRange: { min: 2000 }, onboardingDocuments: [] });
  await dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Synthetic employer', cnpj: '11222333000181', address: 'Synthetic address' });
  const login = await originalFetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${actorId}@example.test`, password: 'synthetic-emulator-password', returnSecureToken: true }) });
  assert.equal(login.ok, true); token = (await login.json()).idToken;
});
test.after(() => { globalThis.fetch = originalFetch; });
async function manual(name) {
  const response = await intake.POST(req('/api/hr/onboarding', { candidateName: `Synthetic ${name}`, candidateEmail: `${name}@example.test`, employmentRelationshipType: 'clt', jobRoleId: roleId, functionId, unitId, employerUnitId: unitId, expectedAdmissionDate: '2026-11-03', transportVoucherValue: 0, integrationMode: 'blank', generateSignatureDocuments: false }));
  const body = await response.json(); assert.equal(response.status, 201, JSON.stringify(body)); return body.process;
}
async function makeTemplate() {
  const zip = new PizZip(); zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Native admission witness</w:t></w:r></w:p></w:body></w:document>');
  const source = zip.generate({ type: 'nodebuffer' }), path = 'company-document-templates/native-admission/source.docx'; await bucket.file(path).save(source, { resumable: false });
  await dbAdmin.collection('companyDocumentTemplates').doc('native-admission-template').set({ name: 'Native admission witness', status: 'published', storagePath: path, version: 1, contentHash: createHash('sha256').update(source).digest('hex'), variables: [], fieldMapping: {}, signatureScope: 'independent', formSchema: { schemaVersion: 1, anchor: 'optional_employee', steps: [] } });
  return 'native-admission-template';
}

test('native manual POST without candidate/account generates and signs with independent embedded person ref; create retries promotion without duplicate identity', async () => {
  const process = await manual('native-manual'); const ref = process.personIdentity.ref;
  assert.equal(ref.namespace, 'hr.onboardingPersons'); assert.notEqual(ref.id, process.id); assert.notEqual(ref.id, process.candidateId);
  assert.equal((await hrDbAdmin.collection('candidates').doc(process.candidateId).get()).exists, false);
  const templateId = await makeTemplate();
  const generated = await generateDocumentFromTemplate({ templateId, onboardingId: process.id, actorAccess: actor, actorId, actorName: actorId, lifecycle: 'final' });
  assert.deepEqual((await dbAdmin.collection('generatedDocuments').doc(generated.id).get()).get('subjectKeys'), [`hr.onboardingPersons:${ref.id}`]);
  const signed = await sendGeneratedDocumentForStandaloneSignature({ generatedDocumentId: generated.id, actorId, actorName: actorId, recipient: 'native-manual@example.test' });
  assert.deepEqual((await hrDbAdmin.collection('hrSignatureRequests').doc(signed.requestId).get()).get('subjectKeys'), [`hr.onboardingPersons:${ref.id}`]);
  const found = await collectPersonSource({ actor, sourceId: 'generated-documents', ref, limit: 25 }); assert.ok(found.items.some((row) => row.id === generated.id));
  const scoped = { ...actor, isDefaultAdmin: false, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: [unitId] }, permissions: { hr: { formalization: { view: true } } } };
  assert.equal((await collectPersonSource({ actor: scoped, sourceId: 'onboarding-persons', ref, limit: 25 })).items[0].id, process.id);
  await assert.rejects(collectPersonSource({ actor: { ...scoped, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['foreign'] } }, sourceId: 'onboarding-persons', ref, limit: 25 }), { code: 'PERSON_SCOPE_UNCONFIRMED' });

  const sourcePath = `hr/onboarding/${process.id}/missing-approved.pdf`;
  await hrDbAdmin.collection('onboardingProcesses').doc(process.id).set({ currentStage: 'integration', documents: [{ id: 'native-approved', label: 'Synthetic approved', status: 'approved', required: false, documentTypeCode: 'IDENTITY_RG', filePath: sourcePath }], publicFormAnswers: { fullName: 'Synthetic manual person' } }, { merge: true });
  const failed = await patch(process.id, { action: 'create_collaborator' }); assert.ok(failed.status >= 400, JSON.stringify(failed));
  const checkpoint = await hrDbAdmin.collection('onboardingProcesses').doc(process.id).get(); const uid = checkpoint.get('personProvisioning.uid');
  assert.ok(uid); assert.equal(checkpoint.get('personProvisioning.state'), 'identities-linked'); assert.equal(checkpoint.get('collaboratorUserId'), uid);
  assert.equal((await authAdmin.getUser(uid)).uid, uid); assert.equal((await dbAdmin.collection('users').doc(uid).get()).get('onboardingPersonRef.id'), ref.id);
  await bucket.file(sourcePath).save(bytes, { resumable: false, metadata: { contentType: 'application/pdf' } });
  const retried = await patch(process.id, { action: 'create_collaborator' }); assert.equal(retried.status, 200, JSON.stringify(retried.body));
  const complete = await hrDbAdmin.collection('onboardingProcesses').doc(process.id).get(); assert.equal(complete.get('personProvisioning.uid'), uid); assert.equal(complete.get('personIdentity.ref.id'), ref.id); assert.equal(complete.get('personProvisioning.state'), 'complete');
  const refs = await confirmedSubjectKeys({ namespace: 'main.users', id: uid }); assert.ok(refs.includes(`hr.onboardingPersons:${ref.id}`)); assert.ok(refs.includes(`hr.employees:${uid}`)); assert.equal(refs.some((key) => key.startsWith('hr.candidates:')), false);
  const documents = await hrDbAdmin.collection('employeeDocuments').where('sourceOnboardingId', '==', process.id).get(); assert.equal(documents.size, 1);
  assert.equal((await patch(process.id, { action: 'create_collaborator' })).status, 409);
  assert.equal((await dbAdmin.collection('users').where('onboardingId', '==', process.id).get()).size, 1);
});

test('real candidate native create persists reciprocal process link before document promotion', async () => {
  const candidateId = 'native-real-candidate', id = 'native-real-recruitment';
  await hrDbAdmin.collection('candidates').doc(candidateId).set({ name: 'Synthetic recruit' });
  await hrDbAdmin.collection('onboardingProcesses').doc(id).set({ source: 'recruitment', candidateId, candidateName: 'Synthetic recruit', candidateEmail: 'native-real-recruitment@example.test', employmentRelationshipType: 'clt', currentStage: 'integration', jobRoleId: roleId, functionId, unitId, employerUnitId: unitId, expectedAdmissionDate: '2026-11-03', finalizationSettings: { operational: false }, documents: [] });
  const result = await patch(id, { action: 'create_collaborator' }); assert.equal(result.status, 200, JSON.stringify(result.body));
  const process = await hrDbAdmin.collection('onboardingProcesses').doc(id).get(); const uid = process.get('collaboratorUserId'); assert.equal(process.get('personProvisioning.state'), 'complete');
  const keys = await confirmedSubjectKeys({ namespace: 'main.users', id: uid }); assert.ok(keys.includes(`hr.candidates:${candidateId}`)); assert.ok(keys.includes(`hr.employees:${uid}`));
});

test('native PJ intake has organization context without fake human candidate and contract sends with no human owner', async () => {
  const response = await intake.POST(req('/api/hr/onboarding', { employmentRelationshipType: 'pj', providerCnpj: '11444777000161', providerLegalName: 'SYNTHETIC COMPANY', candidateEmail: 'native-company@example.test', employerUnitId: unitId, contractStartDate: '2026-11-03', termType: 'indefinite', monthlyValue: 5000, paymentDay: 10, serviceItems: [{ front: 'Service', deliverable: 'Synthetic delivery' }] }));
  const body = await response.json(); assert.equal(response.status, 201, JSON.stringify(body)); const process = body.process;
  assert.equal(process.personIdentity, undefined); assert.equal((await hrDbAdmin.collection('candidates').doc(process.candidateId).get()).exists, false); assert.deepEqual(await confirmedSubjectKeysForDocument(null, process.id), []);
  const path = `hr/onboarding/${process.id}/pj-contracts/v1/contrato.pdf`; await bucket.file(path).save(bytes, { resumable: false });
  await hrDbAdmin.collection('onboardingProcesses').doc(process.id).set({ pjWorkflow: { ...process.pjWorkflow, currentStep: 'contract_signature', contract: { status: 'approved', storagePath: path, contractorRepresentative: { name: 'External contact', email: 'external-company@example.test' } } } }, { merge: true });
  const request = new NextRequest(`http://localhost/api/hr/onboarding/${process.id}/pj-workflow`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send_contract' }) });
  const sent = await pj.PATCH(request, { params: Promise.resolve({ id: process.id }) }); assert.equal(sent.status, 200, await sent.text());
  const signatures = await hrDbAdmin.collection('hrSignatureRequests').where('onboardingId', '==', process.id).get(); assert.equal(signatures.size, 1); assert.deepEqual(signatures.docs[0].get('subjectKeys'), []); assert.deepEqual(signatures.docs[0].get('signerKeys'), []); assert.deepEqual(signatures.docs[0].get('actorKeys'), [`main.users:${actorId}`]);
  const fresh = await hrDbAdmin.collection('onboardingProcesses').doc(process.id).get();
  await fresh.ref.set({ currentStage: 'integration', pjWorkflow: { ...fresh.get('pjWorkflow'), currentStep: 'access_configuration', finance: { status: 'approved' }, access: { status: 'configured', userName: 'Synthetic access person', userCpf: '52998224725', profileId: 'native-admission-worker-profile', unitIds: [unitId], pdvRequired: false } } }, { merge: true });
  const access = await patch(process.id, { action: 'create_collaborator' }); assert.equal(access.status, 200, JSON.stringify(access.body));
  const activated = await fresh.ref.get(); assert.deepEqual(activated.get('subjectKeys'), []); assert.equal(activated.get('personIdentity'), undefined);
  const uid = activated.get('collaboratorUserId'); const user = await dbAdmin.collection('users').doc(uid).get(); assert.equal(user.get('recruitmentCandidateId'), null); assert.equal(user.get('onboardingPersonRef'), null);
  assert.deepEqual(new Set(await confirmedSubjectKeys({ namespace: 'main.users', id: uid })), new Set([`main.users:${uid}`, `hr.employees:${uid}`]));

});

test('legacy UID/HR with proven native placeholders keeps only real refs; false prefix/origin and duplicate locator are refused', async () => {
  const process = await manual('native-legacy'); const pid = process.personIdentity.ref.id, uid = 'native-legacy-account';
  await dbAdmin.collection('users').doc(uid).set({ hrEmployeeId: uid, source: 'recruitment_onboarding', onboardingId: process.id, recruitmentCandidateId: process.candidateId });
  await hrDbAdmin.collection('employees').doc(uid).set({ auth_uid: uid });
  await hrDbAdmin.collection('onboardingProcesses').doc(process.id).set({ collaboratorUserId: uid, employeeId: uid }, { merge: true });
  const keys = await confirmedSubjectKeys({ namespace: 'main.users', id: uid }); assert.deepEqual(new Set(keys), new Set([`main.users:${uid}`, `hr.employees:${uid}`]));
  const templateId = await makeTemplate();
  const generated = await generateDocumentFromTemplate({ templateId, employeeId: uid, onboardingId: process.id, actorAccess: actor, actorId, actorName: actorId });
  assert.ok((await dbAdmin.collection('generatedDocuments').doc(generated.id).get()).get('subjectKeys').includes(`hr.onboardingPersons:${pid}`));
  assert.equal((await hrDbAdmin.collection('onboardingProcesses').doc(process.id).get()).get('personIdentity.ref.id'), pid);
  const bad = hrDbAdmin.collection('onboardingProcesses').doc('false-prefix-origin'); await bad.set({ ...process, source: 'recruitment', id: 'false-prefix-origin', candidateId: 'manual_false-prefix-origin' });
  await assert.rejects(prepareOnboardingPersonForWrite(bad.id), /Candidatura real/);
  await hrDbAdmin.collection('onboardingProcesses').doc('duplicate-locator').set({ ...process });
  const resolved = await resolveStrictPersonRefs({ namespace: 'hr.onboardingPersons', id: pid }, firestorePersonLookup); assert.ok(resolved.conflicts.includes('onboarding_person_missing'));
});

test('readonly census/dry-run preserves qualified embedded UUID, reports pre-account missing identity gap and never proposes placeholder owner', async () => {
  const { spawnSync } = await import('node:child_process'); const { mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { FieldValue } = await import('firebase-admin/firestore'); const { projectCensusData, sha256 } = await import('../../scripts/person-census-core.mjs');
  const process = await manual('native-census'); const pid = process.personIdentity.ref.id;
  const templateId = await makeTemplate(); const generated = await generateDocumentFromTemplate({ templateId, onboardingId: process.id, actorAccess: actor, actorId, actorName: actorId });
  await dbAdmin.collection('generatedDocuments').doc(generated.id).update({ subjectKeys: FieldValue.delete() });
  const root = '.ai-work/development-technology/person-traceability-20261103/census'; mkdirSync(root, { recursive: true, mode: 0o700 }); const targetsFile = `${root}/native-person-targets-${Date.now()}.json`;
  const subject = { namespace: 'hr.onboardingPersons', id: pid };
  writeFileSync(targetsFile, JSON.stringify([{ database: 'main', collection: 'generatedDocuments', id: generated.id, subject }, { database: 'hr', collection: 'onboardingProcesses', id: process.id, subject }]), { mode: 0o600 });
  let outDir;
  try {
    const run = spawnSync(globalThis.process.execPath, ['--import','tsx','scripts/person-census-export.mjs','--project','demo-coala-repository','--workspace','coala','--sources','main/generatedDocuments,hr/onboardingProcesses','--targets',targetsFile], { encoding:'utf8', env: globalThis.process.env });
    assert.equal(run.status, 0, run.stderr); outDir = JSON.parse(run.stdout.trim()).outDir;
    const raw = readFileSync(`${outDir}/census.jsonl`,'utf8'); assert.ok(raw.includes(pid)); assert.equal(raw.includes(`hr.candidates:${process.candidateId}`), false);
    const dry = spawnSync(globalThis.process.execPath, ['--import','tsx','scripts/person-subject-backfill.mjs','--input',`${outDir}/census.jsonl`,'--manifest',`${outDir}/manifest.json`,'--report',`${outDir}/dry.json`], { encoding:'utf8', env: globalThis.process.env }); assert.equal(dry.status, 0, dry.stderr);
    const report = JSON.parse(readFileSync(`${outDir}/dry.json`,'utf8')); const patch = report.patches.find((row) => row.id === generated.id);
    assert.ok(patch, JSON.stringify(report)); assert.deepEqual(patch.add, [`hr.onboardingPersons:${pid}`]); assert.ok(patch.guards.some((guard) => guard.collection === 'onboardingProcesses' && guard.id === process.id)); assert.equal(patch.guards.some((guard) => guard.collection === 'onboardingPersons'), false);
    assert.equal((await hrDbAdmin.collection('onboardingProcesses').doc(process.id).get()).get('personIdentity.ref.id'), pid);
    const legacyId = 'native-readonly-gap', legacy = { ...process }; delete legacy.personIdentity; legacy.id = legacyId; legacy.candidateId = `manual_${legacyId}`;
    const rows = `${JSON.stringify({ database:'hr', collection:'onboardingProcesses', id:legacyId, data:projectCensusData(legacy) })}\n`;
    writeFileSync(`${outDir}/gap.jsonl`, rows, { mode:0o600 }); writeFileSync(`${outDir}/gap-manifest.json`, JSON.stringify({ schema:1, mode:'fixture-readonly', status:'complete', rows:1, sha256:sha256(rows), sources:['hr/onboardingProcesses'], globalCoverage:'incomplete', gaps:[] }), { mode:0o600 });
    const gap = spawnSync(globalThis.process.execPath, ['--import','tsx','scripts/person-subject-backfill.mjs','--input',`${outDir}/gap.jsonl`,'--manifest',`${outDir}/gap-manifest.json`,'--report',`${outDir}/gap-report.json`], { encoding:'utf8', env:globalThis.process.env }); assert.equal(gap.status, 0, gap.stderr);
    const gapReport = JSON.parse(readFileSync(`${outDir}/gap-report.json`,'utf8')); assert.deepEqual(gapReport.patches, []); assert.equal(gapReport.unresolvedReasons.manual_person_identity_missing, 1);
  } finally { rmSync(targetsFile,{ force:true }); if(outDir) rmSync(outDir,{ recursive:true, force:true }); }
});


test('legacy manual profile updates prepare one embedded person on the shared mutating path and preserve strict origin failures', async () => {
  const { FieldValue } = await import('firebase-admin/firestore');
  const { createIntegrationActionAdapter } = await import('../../src/features/hr/integration/runtime-actions.server.ts');
  const process = await manual('native-legacy-profile');
  const reference = hrDbAdmin.collection('onboardingProcesses').doc(process.id);
  await reference.update({ personIdentity: FieldValue.delete() }); delete process.personIdentity;
  assert.equal((await hrDbAdmin.collection('candidates').doc(process.candidateId).get()).exists, false);
  assert.equal(process.collaboratorUserId ?? null, null);
  const adapterFor = (processData) => createIntegrationActionAdapter({ access: { ...actor, actorName: actorId }, execution: {}, processId: processData.id, processData, now: '2026-11-03T00:00:00Z' });
  const adapter = adapterFor(process);
  const first = await adapter.updateProfile({ fieldKey: 'employee.phone', value: 'synthetic-value' });
  const identity = (await reference.get()).get('personIdentity');
  assert.equal(identity.ref.namespace, 'hr.onboardingPersons'); assert.notEqual(identity.ref.id, process.id); assert.notEqual(identity.ref.id, process.candidateId);
  assert.deepEqual(identity.sourceLocator, { onboardingId: process.id, slot: 'applicant' });
  const second = await adapter.updateProfile({ fieldKey: 'employee.phone', value: 'synthetic-updated-value' });
  assert.equal(second.requestId, first.requestId);
  assert.deepEqual((await reference.get()).get('personIdentity'), identity);
  const requests = await hrDbAdmin.collection('hrProfileUpdateRequests').where('onboardingId', '==', process.id).get();
  assert.equal(requests.size, 1); assert.deepEqual(requests.docs[0].get('subjectKeys'), [`hr.onboardingPersons:${identity.ref.id}`]);
  assert.equal(requests.docs[0].get('employeeId'), null); assert.equal(requests.docs[0].get('status'), 'pending_employee_creation');
  assert.equal(requests.docs[0].get('value'), 'synthetic-updated-value');
  assert.equal((await hrDbAdmin.collection('candidates').doc(process.candidateId).get()).exists, false);
  assert.equal((await reference.get()).get('collaboratorUserId') ?? null, null);
  for (const source of ['unproven', 'recruitment']) {
    const invalid = { ...process, id: `native-profile-${source}`, source };
    await hrDbAdmin.collection('onboardingProcesses').doc(invalid.id).set(invalid);
    await assert.rejects(adapterFor(invalid).updateProfile({ fieldKey: 'employee.phone', value: 'synthetic-refused' }), source === 'recruitment' ? /Candidatura real/ : /Origem da admissão/);
    assert.equal((await hrDbAdmin.collection('hrProfileUpdateRequests').where('onboardingId', '==', invalid.id).get()).size, 0);
  }
});

test('legacy unit-only admission context exports safely and enriches readonly dry-run without inventing PID or candidate', async () => {
  const { FieldValue } = await import('firebase-admin/firestore');
  const { spawnSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { projectCensusData, sha256 } = await import('../../scripts/person-census-core.mjs');
  const { onboardingOrigin } = await import('../../src/features/privacy/onboarding-person.ts');
  const { verifyCensusTarget } = await import('../../scripts/person-census-targets.mjs');
  const process = await manual('legacy-unit-context'), uid = 'legacy-context-uid', employeeId = 'legacy-context-hr';
  const reference = hrDbAdmin.collection('onboardingProcesses').doc(process.id);
  await reference.update({ employerUnitId: FieldValue.delete(), personIdentity: FieldValue.delete(), collaboratorUserId: uid, employeeId: uid });
  const legacy = { ...(await reference.get()).data(), id: process.id };
  assert.equal(onboardingOrigin(legacy), 'manual-natural');
  assert.equal(onboardingOrigin({ ...legacy, employerUnitId: '' }), 'unknown');
  assert.equal(onboardingOrigin({ ...legacy, unitId: null }), 'unknown');
  const user = { workspaceId: 'coala', source: 'recruitment_onboarding', onboardingId: process.id, hrEmployeeId: employeeId, recruitmentCandidateId: process.candidateId, unitIds: [unitId] };
  const employee = { workspaceId: 'coala', auth_uid: uid, source_user_id: uid };
  await dbAdmin.collection('users').doc(uid).set(user); await hrDbAdmin.collection('employees').doc(employeeId).set(employee);
  const root = '.ai-work/development-technology/person-traceability-20261103/census', stem = `${root}/legacy-context-${Date.now()}`;
  mkdirSync(stem, { mode: 0o700, recursive: true }); let outDir;
  const run = (args) => spawnSync(globalThis.process.execPath, ['--import', 'tsx', ...args], { encoding: 'utf8', env: globalThis.process.env });
  try {
    const targets = `${stem}/targets.json`; writeFileSync(targets, JSON.stringify([{ database: 'hr', collection: 'onboardingProcesses', id: process.id, subject: { namespace: 'main.users', id: uid } }]), { mode: 0o600 });
    const exported = run(['scripts/person-census-export.mjs', '--project', 'demo-coala-repository', '--workspace', 'coala', '--sources', 'hr/onboardingProcesses', '--targets', targets, '--targets-only']);
    assert.equal(exported.status, 0, exported.stderr); outDir = JSON.parse(exported.stdout.trim()).outDir;
    const context = JSON.parse(readFileSync(`${outDir}/census.jsonl`, 'utf8').trim()), contextManifest = JSON.parse(readFileSync(`${outDir}/manifest.json`, 'utf8'));
    assert.equal(context.contextOnly, true); assert.equal(context.contextReason, 'manual_person_identity_missing');
    assert.equal(contextManifest.targeted.accepted, 1); assert.equal(contextManifest.targeted.rejected, 0); assert.equal(contextManifest.status, 'incomplete');
    assert.ok(contextManifest.gaps.some((gap) => gap.reason === 'manual_person_identity_missing'));
    const rows = [
      { database: 'main', collection: 'users', id: uid, data: projectCensusData(user) },
      { database: 'hr', collection: 'employees', id: employeeId, data: projectCensusData(employee) },
      { database: 'hr', collection: 'employeeDocuments', id: 'legacy-context-doc-linked', data: { employeeId: uid, sourceOnboardingId: process.id } },
      { database: 'hr', collection: 'employeeDocuments', id: 'legacy-context-doc-via-user', data: { employeeId: uid } },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n';
    const input = `${stem}/base.jsonl`, manifestPath = `${stem}/manifest.json`;
    writeFileSync(input, rows, { mode: 0o600 }); writeFileSync(manifestPath, JSON.stringify({ schema: 1, mode: 'emulator-readonly', projectId: 'demo-coala-repository', workspace: 'coala', status: 'complete', rows: 4, sha256: sha256(rows), sources: [], gaps: [] }), { mode: 0o600 });
    const dryArgs = ['scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifestPath];
    const missing = run([...dryArgs, '--report', `${stem}/missing.json`]); assert.equal(missing.status, 0, missing.stderr);
    const missingReport = JSON.parse(readFileSync(`${stem}/missing.json`, 'utf8')); assert.deepEqual(missingReport.patches, []); assert.equal(missingReport.unresolvedReasons.onboarding_context_missing, 2); assert.equal(missingReport.evidenceMissing, 2); assert.equal(missingReport.conflicts, 0);
    const enriched = run([...dryArgs, '--context-run', outDir, '--report', `${stem}/enriched.json`]); assert.equal(enriched.status, 0, enriched.stderr);
    const report = JSON.parse(readFileSync(`${stem}/enriched.json`, 'utf8')); assert.equal(report.contextEvidence.rows, 1); assert.equal(report.contextGaps.manual_person_identity_missing, 1); assert.equal(report.patches.length, 2);
    for (const patch of report.patches) { assert.deepEqual(patch.add, [`main.users:${uid}`, `hr.employees:${employeeId}`]); assert.ok(patch.guards.some((guard) => guard.collection === 'onboardingProcesses' && guard.id === process.id)); }
    assert.equal(report.patches.some((patch) => patch.collection === 'onboardingProcesses'), false);
    assert.equal(JSON.stringify(report.patches).includes('hr.candidates:'), false); assert.equal(JSON.stringify(report.patches).includes('hr.onboardingPersons:'), false);
    assert.equal((await reference.get()).get('personIdentity'), undefined); assert.equal((await hrDbAdmin.collection('candidates').doc(process.candidateId).get()).exists, false);
    await assert.rejects(verifyCensusTarget({ target: { database: 'hr', collection: 'onboardingProcesses', id: process.id, subject: { namespace: 'main.users', id: actorId } }, data: projectCensusData(legacy), workspace: 'coala', maxReads: 100, dbFor: (database) => database === 'main' ? dbAdmin : hrDbAdmin }), /scope_mismatch/);
    const wrongWorkspace = await verifyCensusTarget({ target: { database: 'hr', collection: 'onboardingProcesses', id: process.id, subject: { namespace: 'main.users', id: uid } }, data: { ...projectCensusData(legacy), workspaceId: 'foreign' }, workspace: 'coala', maxReads: 100, dbFor: (database) => database === 'main' ? dbAdmin : hrDbAdmin }); assert.equal(wrongWorkspace.ok, false);
    const oldManifest = contextManifest; writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ ...oldManifest, workspace: 'foreign' }), { mode: 0o600 });
    const crossed = run([...dryArgs, '--context-run', outDir, '--report', `${stem}/crossed.json`]); assert.notEqual(crossed.status, 0); assert.match(crossed.stderr, /Manifesto de contexto/);
    const prepared = await prepareOnboardingPersonForWrite(process.id);
    const retried = await prepareOnboardingPersonForWrite(process.id);
    assert.deepEqual(retried.personIdentity, prepared.personIdentity);
    assert.equal((await reference.get()).get('personIdentity.ref.namespace'), 'hr.onboardingPersons');
    assert.equal((await reference.get()).get('personIdentity.provisioningLink.hrEmployeeId'), employeeId);
    assert.equal((await reference.get()).get('employeeId'), uid); // Historical operational field is preserved.
    const templateId = await makeTemplate();
    const generated = await generateDocumentFromTemplate({ templateId, onboardingId: process.id, employeeId: uid, actorId, actorName: actorId });
    const generatedKeys = (await dbAdmin.collection('generatedDocuments').doc(generated.id).get()).get('subjectKeys');
    assert.deepEqual(new Set(generatedKeys), new Set([`main.users:${uid}`, `hr.employees:${employeeId}`, `hr.onboardingPersons:${prepared.personIdentity.ref.id}`]));
    assert.equal((await hrDbAdmin.collection('candidates').doc(process.candidateId).get()).exists, false);
  } finally { rmSync(stem, { recursive: true, force: true }); if (outDir) rmSync(outDir, { recursive: true, force: true }); }
});
