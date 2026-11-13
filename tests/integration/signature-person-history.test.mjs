import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { getStorage } from 'firebase-admin/storage';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '', /^(localhost|127\.0\.0\.1):\d+$/);
enableServerOnlyTestImports('demo-coala-repository');
const { dbAdmin, adminApp } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { sendGeneratedDocumentForStandaloneSignature, archiveAutentiqueSignedDocument } = await import('../../src/features/hr/documents/signature-workflow.server.ts');
const { collectPersonSource } = await import('../../src/features/privacy/person-inventory.server.ts');
const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('real send with local fake provider freezes ownership through account removal/collision, callback and retry', async (t) => {
  const originalFetch = globalThis.fetch;
  const oldToken = process.env.AUTENTIQUE_API_TOKEN;
  process.env.AUTENTIQUE_API_TOKEN = 'local-fake-provider-no-real-token';
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  let sends = 0; let downloads = 0;
  const signedUrl = 'https://api.autentique.com.br/local-person-history.pdf';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://api.autentique.com.br/v2/graphql') {
      sends++;
      return Response.json({ data: { createDocument: { id: `fake-person-provider-${sends}`, created_at: '2026-11-03T00:00:00Z', signatures: [] } } });
    }
    if (url === signedUrl) { downloads++; return new Response(bytes, { headers: { 'content-type': 'application/pdf' } }); }
    if (/^https?:\/\/(localhost|127\.0\.0\.1):/.test(url)) return originalFetch(input, init);
    throw new Error('External network disabled in person-history witness');
  };
  const refs = [];
  const prefixes = [];
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.AUTENTIQUE_API_TOKEN; else process.env.AUTENTIQUE_API_TOKEN = oldToken;
    await Promise.all(refs.map((ref) => ref.firestore.recursiveDelete(ref)));
    for (const prefix of prefixes) await bucket.deleteFiles({ prefix });
  });
  for (const mode of ['removed', 'collision']) {
    const uid = `review-history-${mode}`;
    const generatedId = `review-history-document-${mode}`;
    const user = dbAdmin.collection('users').doc(uid);
    const generated = dbAdmin.collection('generatedDocuments').doc(generatedId);
    const request = hrDbAdmin.collection('hrSignatureRequests').doc(`signature_generated_${generatedId}`);
    const archivedId = createHash('sha256').update(`signed-generated-document:${generatedId}`).digest('hex').slice(0, 32);
    const originalPath = `generated-documents/${generatedId}/source.pdf`;
    prefixes.push(`generated-documents/${generatedId}/`, `signature-documents/${generatedId}/`, `signed-documents/generated/${generatedId}/`);
    refs.push(user, generated, request, hrDbAdmin.collection('employeeDocuments').doc(archivedId));
    await user.set({ username: 'Synthetic', documentSignatureEmail: `${uid}@example.test` });
    await bucket.file(originalPath).save(bytes, { resumable: false });
    await generated.set({ status: 'final', signatureScope: 'independent', employeeId: uid, subjectKeys: [`main.users:${uid}`], partyKeys: [], protocol: `TEST-${mode}`, templateId: 'review-local-template', templateVersion: 1, templateName: 'Synthetic historical document', documentTypeCode: 'UNKNOWN_DOCUMENT', pdfStoragePath: originalPath, pdfContentHash: hash(bytes), docxContentHash: hash(bytes) });
    const sent = await sendGeneratedDocumentForStandaloneSignature({ generatedDocumentId: generatedId, actorId: 'review-actor', actorName: 'Synthetic staff' });
    assert.equal(sent.reused, false);
    const frozen = await request.get();
    assert.deepEqual(frozen.get('subjectKeys'), [`main.users:${uid}`]);
    assert.deepEqual(frozen.get('actorKeys'), ['main.users:review-actor']);
    assert.deepEqual(frozen.get('signerKeys'), [`main.users:${uid}`]);
    assert.equal(frozen.get('personBinding.requestId'), request.id);
    await generated.update({ templateVersion: 2 });
    const beforeRejectedDownload = downloads;
    await assert.rejects(archiveAutentiqueSignedDocument({ signatureRequestId: request.id, signedUrl }), /versão documental/);
    assert.equal(downloads, beforeRejectedDownload);
    await generated.update({ templateVersion: 1 });
    await user.delete();
    if (mode === 'collision') {
      const employee = hrDbAdmin.collection('employees').doc(uid);
      refs.push(employee);
      await employee.set({ auth_uid: 'different-account-after-send' });
      await user.set({ hrEmployeeId: 'different-employee-after-send' });
    }
    const id = await archiveAutentiqueSignedDocument({ signatureRequestId: request.id, signedUrl });
    const stored = await hrDbAdmin.collection('employeeDocuments').doc(id).get();
    refs.push(stored.ref);
    assert.deepEqual(stored.get('subjectKeys'), [`main.users:${uid}`]);
    assert.equal(stored.get('employeeId'), uid);
    assert.equal(stored.get('contentHash'), hash(bytes));
    const count = downloads;
    assert.equal(await archiveAutentiqueSignedDocument({ signatureRequestId: request.id, signedUrl }), id);
    assert.equal(downloads, count, 'idempotent retry does not download or resolve current aliases');
    assert.deepEqual((await bucket.file(stored.get('storagePath')).download())[0], bytes);
    await request.update({ packageHash: '0'.repeat(64) });
    await assert.rejects(archiveAutentiqueSignedDocument({ signatureRequestId: request.id, signedUrl }), /origem ou versão/);
  }
  assert.equal(sends, 2);
});

test('generator indexes explicitly selected HR parties without owner anchor and never promotes representatives to subject', async (t) => {
  const { default: PizZip } = await import('pizzip');
  const { generateDocumentFromTemplate } = await import('../../src/features/hr/documents/generate-document.server.ts');
  const originalFetch = globalThis.fetch; const oldUrl = process.env.DOCX_TO_PDF_URL;
  const oldAudience = process.env.DOCX_TO_PDF_AUDIENCE; const oldToken = process.env.DOCX_TO_PDF_ID_TOKEN;
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  process.env.DOCX_TO_PDF_URL = 'http://127.0.0.1:7999/forms/libreoffice/convert'; delete process.env.DOCX_TO_PDF_AUDIENCE; delete process.env.DOCX_TO_PDF_ID_TOKEN;
  globalThis.fetch = (input, init) => String(input) === process.env.DOCX_TO_PDF_URL ? Promise.resolve(new Response(bytes)) : originalFetch(input, init);
  const template = dbAdmin.collection('companyDocumentTemplates').doc('review-parties-template');
  const employee = hrDbAdmin.collection('employees').doc('review-party-only');
  const user = dbAdmin.collection('users').doc('review-party-viewer');
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Witness party document</w:t></w:r></w:p></w:body></w:document>');
  const sourcePath = 'company-document-templates/review-parties/source.docx';
  let generated = null;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [['DOCX_TO_PDF_URL', oldUrl], ['DOCX_TO_PDF_AUDIENCE', oldAudience], ['DOCX_TO_PDF_ID_TOKEN', oldToken]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await Promise.all([template, employee, user].map((ref) => ref.firestore.recursiveDelete(ref)));
    await bucket.file(sourcePath).delete({ ignoreNotFound: true });
    if (generated) { await dbAdmin.recursiveDelete(dbAdmin.collection('generatedDocuments').doc(generated.id)); await bucket.deleteFiles({ prefix: `generated-documents/standalone/${generated.id}/` }); }
  });
  await employee.set({ name: 'Synthetic participant' }); await user.set({});
  const source = zip.generate({ type: 'nodebuffer' });
  await bucket.file(sourcePath).save(source, { resumable: false });
  await template.set({ name: 'Synthetic parties', status: 'published', storagePath: sourcePath, contentHash: hash(source), version: 1, variables: [], fieldMapping: {}, formSchema: { schemaVersion: 1, anchor: 'none', steps: [{ id: 'parties', title: 'Parties', fields: [{ key: 'representative', label: 'Representative', kind: 'party', required: true, partyRole: 'witness', allowedPartyTypes: ['employee'] }] }] } });
  generated = await generateDocumentFromTemplate({ templateId: template.id, actorAccess: { decoded: { uid: user.id }, userDoc: {}, isDefaultAdmin: true, workspace_id: "coala" }, actorId: user.id, actorName: 'Synthetic actor', formValues: { representative: { partyType: 'employee', ref: employee.id, snapshot: { name: 'Synthetic participant' } } } });
  const row = await dbAdmin.collection('generatedDocuments').doc(generated.id).get();
  assert.deepEqual(row.get('subjectKeys'), []);
  assert.deepEqual(row.get('partyKeys'), [`hr.employees:${employee.id}`]);
  const actor = { decoded: { uid: user.id }, isDefaultAdmin: true, workspace_id: 'coala', userDoc: {}, permissions: {} };
  const participants = await collectPersonSource({ actor, sourceId: 'generated-document-parties', ref: { namespace: 'hr.employees', id: employee.id }, limit: 25 });
  assert.equal(participants.items.some((item) => item.id === generated.id && item.role === 'participant'), true);
  const owners = await collectPersonSource({ actor, sourceId: 'generated-documents', ref: { namespace: 'hr.employees', id: employee.id }, limit: 25 });
  assert.equal(owners.items.some((item) => item.id === generated.id), false);
});

test('integration adapter and PJ route persist organization context and actors without inventing human owner or signer IDs', async (t) => {
  const { createIntegrationActionAdapter } = await import('../../src/features/hr/integration/runtime-actions.server.ts');
  const { PATCH } = await import('../../src/app/api/hr/onboarding/[id]/pj-workflow/route.ts');
  const { NextRequest } = await import('next/server');
  const { authAdmin } = await import('../../src/lib/firebase-admin.ts');
  const uid = 'review-producer-actor', profileId = 'review-producer-admin';
  const processRef = hrDbAdmin.collection('onboardingProcesses').doc('review-producer-pj');
  const profile = dbAdmin.collection('profiles').doc(profileId); const user = dbAdmin.collection('users').doc(uid);
  const originalFetch = globalThis.fetch; const oldToken = process.env.AUTENTIQUE_API_TOKEN;
  process.env.AUTENTIQUE_API_TOKEN = 'local-fake-provider-no-real-token';
  globalThis.fetch = (input, init) => String(input) === 'https://api.autentique.com.br/v2/graphql'
    ? Promise.resolve(Response.json({ data: { createDocument: { id: 'fake-pj-provider', created_at: '2026-11-03T00:00:00Z', signatures: [] } } }))
    : /^https?:\/\/(localhost|127\.0\.0\.1):/.test(String(input)) ? originalFetch(input, init) : Promise.reject(new Error('Unexpected external network in PJ witness'));
  const path = 'hr/onboarding/review-producer-pj/pj-contracts/v1/contrato.pdf';
  const requests = [];
  t.after(async () => {
    globalThis.fetch = originalFetch; if (oldToken === undefined) delete process.env.AUTENTIQUE_API_TOKEN; else process.env.AUTENTIQUE_API_TOKEN = oldToken;
    await Promise.all([processRef, profile, user, ...requests].map((ref) => ref.firestore.recursiveDelete(ref)));
    await authAdmin.deleteUser(uid); await bucket.file(path).delete({ ignoreNotFound: true });
  });
  await authAdmin.createUser({ uid, email: `${uid}@example.test`, password: 'synthetic-emulator-password' });
  await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
  await profile.set({ isDefaultAdmin: true, permissions: {} });
  await user.set({ username: uid, profileId, isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 } });
  const processData = { source: 'manual', applicationId: null, jobOpeningId: null, employerUnitId: 'synthetic-unit', providerCnpj: '11444777000161', candidateId: `pj_${processRef.id}`, candidateEmail: 'external-pj@example.test', employmentRelationshipType: 'pj', currentStage: 'signature', pjWorkflow: { version: 1, currentStep: 'contract_signature', provider: { cnpj: '11444777000161', legalName: 'Synthetic provider', email: 'external-pj@example.test' }, contract: { status: 'approved', storagePath: path, contractorRepresentative: { name: 'External representative', email: 'external-company@example.test' } } } };
  await processRef.set(processData);
  const access = { decoded: { uid }, userDoc: {}, profileId, isDefaultAdmin: true, permissions: {}, actorName: uid };
  const adapter = createIntegrationActionAdapter({ access, execution: {}, processId: processRef.id, processData, now: '2026-11-03T00:00:00Z' });
  for (const [actionId, signers, expected] of [['default', undefined, []], ['external', [{ email: 'external@example.test' }], []], ['explicit', [{ email: `${uid}@example.test`, subjectRef: { namespace: 'main.users', id: uid } }], [`main.users:${uid}`]]]) {
    const output = await adapter.requestSignature({ provider: 'internal', actionId, ...(signers ? { signers } : {}) });
    const ref = hrDbAdmin.collection('hrSignatureRequests').doc(output.signatureRequestId); requests.push(ref);
    const stored = await ref.get();
    assert.deepEqual(stored.get('subjectKeys'), []);
    assert.deepEqual(stored.get('actorKeys'), [`main.users:${uid}`]);
    assert.deepEqual(stored.get('signerKeys'), expected);
  }
  await bucket.file(path).save(Buffer.from('%PDF-synthetic-pj'), { resumable: false });
  const login = await originalFetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.test`, password: 'synthetic-emulator-password', returnSecureToken: true }) });
  assert.equal(login.ok, true);
  const token = (await login.json()).idToken;
  const response = await PATCH(new NextRequest('http://localhost/api/hr/onboarding/review-producer-pj/pj-workflow', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send_contract' }) }), { params: Promise.resolve({ id: processRef.id }) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  const sent = await hrDbAdmin.collection('hrSignatureRequests').where('onboardingId', '==', processRef.id).get();
  const pj = sent.docs.find((row) => row.get('source') === 'pj_onboarding_contract');
  assert.ok(pj); requests.push(pj.ref);
  assert.deepEqual(pj.get('subjectKeys'), []);
  assert.deepEqual(pj.get('actorKeys'), [`main.users:${uid}`]);
  assert.deepEqual(pj.get('signerKeys'), []);
});

test('admission package request records company signer separately from candidate subject and preparer', async (t) => {
  const { prepareAdmissionSignaturePlacement } = await import('../../src/features/hr/documents/signature-workflow.server.ts');
  const { admissionSignaturePackageTemplateIds } = await import('../../src/features/hr/documents/admission-signature-order.ts');
  const { default: PizZip } = await import('pizzip');
  const onboardingId = 'review-company-package';
  const processRef = hrDbAdmin.collection('onboardingProcesses').doc(onboardingId);
  const candidate = hrDbAdmin.collection('candidates').doc(`${onboardingId}-candidate`);
  const companySigner = dbAdmin.collection('users').doc(`${onboardingId}-signer`);
  const entity = dbAdmin.collection('entities').doc(`${onboardingId}-entity`);
  const closing = dbAdmin.collection('companyDocumentTemplates').doc('system-admission-bundle-closing-term');
  const request = hrDbAdmin.collection('hrSignatureRequests').doc(`signature_bundle_${onboardingId}`);
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const sourcePath = `generated-documents/${onboardingId}/source.pdf`, closingPath = `company-document-templates/${onboardingId}/source.docx`;
  const oldUrl = process.env.DOCX_TO_PDF_URL, oldAudience = process.env.DOCX_TO_PDF_AUDIENCE, oldToken = process.env.DOCX_TO_PDF_ID_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.DOCX_TO_PDF_URL = 'http://127.0.0.1:7999/forms/libreoffice/convert'; delete process.env.DOCX_TO_PDF_AUDIENCE; delete process.env.DOCX_TO_PDF_ID_TOKEN;
  globalThis.fetch = (input, init) => String(input) === process.env.DOCX_TO_PDF_URL ? Promise.resolve(new Response(bytes)) : originalFetch(input, init);
  const refs = [processRef, candidate, companySigner, entity, closing, request];
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [['DOCX_TO_PDF_URL', oldUrl], ['DOCX_TO_PDF_AUDIENCE', oldAudience], ['DOCX_TO_PDF_ID_TOKEN', oldToken]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    const generated = await dbAdmin.collection('generatedDocuments').where('onboardingId', '==', onboardingId).get();
    refs.push(...generated.docs.map((row) => row.ref));
    await Promise.all(refs.map((ref) => ref.firestore.recursiveDelete(ref)));
    for (const prefix of [`generated-documents/${onboardingId}/`, `company-document-templates/${onboardingId}/`, `signature-packages/${onboardingId}/`]) await bucket.deleteFiles({ prefix });
  });
  await candidate.set({}); await companySigner.set({ username: 'Synthetic company signer', email: 'company-package@example.test' });
  await entity.set({ documentSignatoryUserId: companySigner.id });
  await processRef.set({ source: 'recruitment', candidateId: candidate.id, candidateName: 'Synthetic candidate', candidateEmail: 'candidate-package@example.test', currentStage: 'signature_preparation', publicFormAnswers: { wantsTransportVoucher: false } });
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic closing</w:t></w:r></w:p></w:body></w:document>');
  const docx = zip.generate({ type: 'nodebuffer' });
  await bucket.file(closingPath).save(docx, { resumable: false }); await bucket.file(sourcePath).save(bytes, { resumable: false });
  await closing.set({ name: 'Synthetic closing', status: 'published', storagePath: closingPath, version: 1, contentHash: hash(docx), variables: [], fieldMapping: {} });
  for (const [index, templateId] of admissionSignaturePackageTemplateIds(false).entries()) {
    const generated = dbAdmin.collection('generatedDocuments').doc(`${onboardingId}-generated-${index}`);
    const workflow = hrDbAdmin.collection('hrSignatureDocuments').doc(`${onboardingId}-workflow-${index}`);
    refs.push(generated, workflow);
    await generated.set({ docxContentHash: hash(docx), legalEntitySnapshot: { entityId: entity.id, legalName: 'Synthetic entity' } });
    await workflow.set({ onboardingId, templateId, templateName: templateId, selected: true, status: 'ready_to_send', signatureScope: 'bundle', generatedDocumentId: generated.id, generatedPdfStoragePath: sourcePath });
  }
  await prepareAdmissionSignaturePlacement({ onboardingId, actorId: 'review-preparer', actorName: 'Synthetic staff' });
  const stored = await request.get();
  assert.deepEqual(stored.get('subjectKeys'), [`hr.candidates:${candidate.id}`]);
  assert.deepEqual(new Set(stored.get('signerKeys')), new Set([`hr.candidates:${candidate.id}`, `main.users:${companySigner.id}`]));
  assert.deepEqual(stored.get('actorKeys'), ['main.users:review-preparer']);
  assert.equal(stored.get('personBinding.requestId'), request.id);
});

test('generate POST rejects forged out-of-unit HR party before effects; picker and allowed generation resolve distinct UID/HR IDs', async (t) => {
  const { POST } = await import('../../src/app/api/documents/generate/route.ts');
  const { GET: partiesGET } = await import('../../src/app/api/documents/generator/parties/route.ts');
  const { NextRequest } = await import('next/server');
  const { authAdmin } = await import('../../src/lib/firebase-admin.ts');
  const { default: PizZip } = await import('pizzip');
  const { generateDocumentFromTemplate } = await import('../../src/features/hr/documents/generate-document.server.ts');
  const actorId = 'residual-generator-actor', profileId = `${actorId}-profile`;
  const template = dbAdmin.collection('companyDocumentTemplates').doc('residual-generator-template');
  const rows = [template, dbAdmin.collection('users').doc(actorId), dbAdmin.collection('profiles').doc(profileId)];
  const paths = ['company-document-templates/residual-generator/source.docx']; const generatedRows = [];
  const originalFetch = globalThis.fetch; const oldUrl = process.env.DOCX_TO_PDF_URL;
  process.env.DOCX_TO_PDF_URL = 'http://127.0.0.1:7999/forms/libreoffice/convert';
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  globalThis.fetch = (input, init) => String(input) === process.env.DOCX_TO_PDF_URL ? Promise.resolve(new Response(bytes)) : originalFetch(input, init);
  t.after(async () => {
    globalThis.fetch = originalFetch; if (oldUrl === undefined) delete process.env.DOCX_TO_PDF_URL; else process.env.DOCX_TO_PDF_URL = oldUrl;
    await Promise.all([...rows, ...generatedRows].map((r) => r.firestore.recursiveDelete(r)));
    await authAdmin.deleteUser(actorId); for (const path of paths) await bucket.file(path).delete({ ignoreNotFound: true });
    for (const row of generatedRows) await bucket.deleteFiles({ prefix: `generated-documents/standalone/${row.id}/` });
    await bucket.deleteFiles({ prefix: 'generated-documents/residual-internal-candidate/' });
  });
  await authAdmin.createUser({ uid: actorId, email: `${actorId}@example.test`, password: 'synthetic-emulator-password' });
  await authAdmin.setCustomUserClaims(actorId, { profileId, sessionVersion: 0 });
  await rows[1].set({ username: actorId, profileId, isActive: true, sessionVersion: 0, unitAccessScope: 'selected', unitAccessUnitIds: ['A'], unitIds: ['A'], profileCompliance: { status: 'complete', policyVersion: 1 } });
  await rows[2].set({ permissions: { hr: { formalization: { documents: { generate: true } } } } });
  for (const unit of ['A', 'B']) {
    const uid = `residual-generator-uid-${unit}`, hrId = `residual-generator-hr-${unit}`;
    const user = dbAdmin.collection('users').doc(uid), employee = hrDbAdmin.collection('employees').doc(hrId), cpf = employee.collection('field_values').doc('employee.cpf'); rows.push(user, employee);
    await user.set({ hrEmployeeId: hrId, unitIds: [unit], workspaceId: 'coala' });
    await employee.set({ auth_uid: uid, name: `Synthetic ${unit}`, email: `synthetic-${unit}@example.test`, workspaceId: 'coala' });
    await cpf.set({ value_text: unit === 'B' ? 'RESTRICTED_CPF_WITNESS' : 'ALLOWED_CPF_WITNESS' });
  }
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic selected party</w:t></w:r></w:p></w:body></w:document>');
  const source = zip.generate({ type: 'nodebuffer' }); await bucket.file(paths[0]).save(source, { resumable: false });
  await template.set({ name: 'Residual generation witness', status: 'published', storagePath: paths[0], contentHash: hash(source), version: 1, variables: [], fieldMapping: {}, formSchema: { schemaVersion: 1, anchor: 'none', steps: [{ id: 'party', title: 'Party', fields: [{ key: 'representative', label: 'Representative', kind: 'party', required: false, partyRole: 'witness', allowedPartyTypes: ['employee'] }] }] } });
  const login = await originalFetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${actorId}@example.test`, password: 'synthetic-emulator-password', returnSecureToken: true }) });
  const token = (await login.json()).idToken;
  const req = (path, body) => new NextRequest(`http://localhost${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const bodyFor = (unit) => ({ templateId: template.id, output: 'json', formValues: { representative: { partyType: 'employee', ref: `residual-generator-hr-${unit}`, snapshot: { name: `Synthetic ${unit}` } } } });
  const before = (await bucket.getFiles({ prefix: 'generated-documents/standalone/' }))[0].length;
  const forbidden = await POST(req('/api/documents/generate', bodyFor('B')), { params: Promise.resolve({}) }); assert.equal(forbidden.status, 403, await forbidden.text());
  assert.equal((await dbAdmin.collection('generatedDocuments').where('templateId', '==', template.id).get()).size, 0);
  assert.equal((await bucket.getFiles({ prefix: 'generated-documents/standalone/' }))[0].length, before);
  const forgedTrust = await POST(req('/api/documents/generate', { ...bodyFor('B'), actorAccess: { isDefaultAdmin: true } }), { params: Promise.resolve({}) }); assert.equal(forgedTrust.status, 400);
  const picker = await partiesGET(req('/api/documents/generator/parties'), { params: Promise.resolve({}) }); assert.equal(picker.status, 200);
  const options = await picker.json(); assert.equal(options.parties.some((x) => x.id === 'residual-generator-hr-A'), true); assert.equal(options.parties.some((x) => x.id === 'residual-generator-hr-B'), false); assert.equal(JSON.stringify(options).includes('RESTRICTED_CPF_WITNESS'), false);
  const allowed = await POST(req('/api/documents/generate', bodyFor('A')), { params: Promise.resolve({}) }); const saved = await allowed.json(); assert.equal(allowed.status, 200, JSON.stringify(saved));
  const generated = dbAdmin.collection('generatedDocuments').doc(saved.document.id); generatedRows.push(generated);
  assert.deepEqual(new Set((await generated.get()).get('partyKeys')), new Set(['hr.employees:residual-generator-hr-A', 'main.users:residual-generator-uid-A'])); assert.deepEqual((await generated.get()).get('subjectKeys'), []);
  const candidate = hrDbAdmin.collection('candidates').doc('residual-internal-candidate'); const processRef = hrDbAdmin.collection('onboardingProcesses').doc('residual-internal-candidate'); rows.push(candidate, processRef);
  await candidate.set({}); await processRef.set({ source: 'recruitment', candidateId: candidate.id });
  const internal = await generateDocumentFromTemplate({ templateId: template.id, onboardingId: processRef.id, actorId, actorName: 'Internal process' }); generatedRows.push(dbAdmin.collection('generatedDocuments').doc(internal.id));
  assert.deepEqual((await generatedRows[1].get()).get('subjectKeys'), [`hr.candidates:${candidate.id}`]);
});
