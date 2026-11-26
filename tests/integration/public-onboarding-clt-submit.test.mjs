import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const route = await import('../../src/app/api/hr/onboarding/public/[token]/route.ts');
const ai = await import('../../src/features/hr/onboarding/document-ai-extraction.ts');
const { DEFAULT_ONBOARDING_DOCUMENTS } = await import('../../src/lib/recruitment-onboarding.ts');

const processes = hrDbAdmin.collection('onboardingProcesses');
const context = (token) => ({ params: Promise.resolve({ token }) });
const url = (token) => `http://localhost/api/hr/onboarding/public/${token}`;
const hashOf = (value) => createHash('sha256').update(value).digest('hex');
const typeOf = (id) => DEFAULT_ONBOARDING_DOCUMENTS.find((item) => item.id === id)?.documentTypeCode ?? ai.inferredOnboardingDocumentTypeCode(id);

/** O que a rota de upload deixa para trás: leitura só para documento com tipo, e nunca para a foto. */
async function uploadLikeRealFlow(ref, documentId, content, { withReading = true } = {}) {
  const sha256 = hashOf(`${content}-${documentId}`);
  const code = documentId === 'profile_photo' ? null : typeOf(documentId);
  if (code && withReading) {
    const record = ai.buildOnboardingDocumentExtractionRecord({
      documentId, sourceFileHashSha256: sha256, expectedDocumentTypeCode: code, analyzedAt: new Date().toISOString(), durationMs: 10,
      result: { provider: 'openai', model: 'modelo-sintetico', promptVersion: '1', schemaVersion: '1', documentTypeCode: code,
        documentTypeConfidence: 0.95, employeeMatchStatus: 'MATCH', identifiedEmployeeName: null,
        structure: { legibility: 'GOOD', multipleDocumentsDetected: false, pageCount: 1 }, extractedFields: {}, fieldConfidences: {},
        issues: [], warnings: [], inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
    });
    await ref.collection('documentExtractions').doc(ai.onboardingDocumentExtractionCacheId(documentId, sha256)).set(record);
  }
  const token = (await ref.get()).get('publicToken');
  const filePath = `hr/onboarding/${token}/${documentId}-${sha256}.pdf`;
  const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${globalThis.process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(filePath)}?alt=media`;
  return { fileUrl, filePath, sha256 };
}

async function openProcess(key) {
  const ref = processes.doc(`clt-submit-${key}`);
  const token = `token-clt-submit-${key}`;
  await ref.set({ publicToken: token, candidateName: 'Pessoa Sintética', status: 'pending', documents: [],
    publicTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  const view = await (await route.GET(new NextRequest(url(token)), context(token))).json();
  return { ref, token, view };
}

async function submit({ token, view }, documents, ip) {
  const response = await route.POST(new NextRequest(url(token), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      answers: { fullName: 'Pessoa Sintética', cpf: '12345678909', maritalStatus: 'Solteiro(a)', hasChildren: 'no',
        emergencyName: 'Contato Sintético', emergencyPhone: '(98) 99999-0000', emergencyRelation: 'Mãe/Pai', hasFoodRestriction: 'no' },
      documents,
      privacyAcceptance: { noticeVersion: view.privacyNotice.version, noticeHash: view.privacyNotice.hash, acknowledged: true,
        allergyAcknowledged: true, allergyNoticeVersion: view.privacyNotice.allergyNoticeVersion, allergyNoticeHash: view.privacyNotice.allergyNoticeHash },
      imageVoiceConsent: { authorized: false, termVersion: view.imageVoiceConsentTerm.version, termHash: view.imageVoiceConsentTerm.hash, decisionChanged: true },
    }),
  }), context(token));
  return { status: response.status, body: await response.json() };
}

const storedDocument = async (ref, id) => (await ref.get()).get('documents').find((item) => item.id === id);

for (const [name, pick, ip] of [
  ['todos os documentos', () => true, '198.51.100.21'],
  ['somente os obrigatórios', (item) => item.required, '198.51.100.22'],
]) {
  test(`envio CLT com ${name}, com a foto sem leitura, grava o cadastro`, { timeout: 120_000 }, async () => {
    const process = await openProcess(ip.split('.').at(-1));
    try {
      const chosen = process.view.documents.filter(pick);
      assert.ok(chosen.some((item) => item.id === 'profile_photo' && item.required), 'a foto é obrigatória na lista padrão');
      const documents = {};
      for (const item of chosen) documents[item.id] = await uploadLikeRealFlow(process.ref, item.id, 'arquivo');
      const result = await submit(process, documents, ip);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok((await process.ref.get()).get('publicFormSubmittedAt'));
      const photo = await storedDocument(process.ref, 'profile_photo');
      assert.equal(photo.aiAnalysis ?? null, null);
      assert.equal(photo.fileUrl, documents.profile_photo.fileUrl);
      assert.equal((await storedDocument(process.ref, 'identity_document')).aiAnalysis.provider, 'openai');
    } finally {
      await hrDbAdmin.recursiveDelete(process.ref);
    }
  });
}

test('envio CLT sem nenhuma leitura funciona, e trocar o arquivo apaga a leitura do anterior', { timeout: 120_000 }, async () => {
  const process = await openProcess('troca');
  try {
    const first = {};
    for (const item of process.view.documents) first[item.id] = await uploadLikeRealFlow(process.ref, item.id, 'primeiro');
    assert.equal((await submit(process, first, '198.51.100.23')).status, 200);
    assert.ok((await storedDocument(process.ref, 'identity_document')).aiAnalysis);
    // O RH reabre o link e libera o documento para substituição; o novo arquivo chega sem leitura.
    const saved = (await process.ref.get()).get('documents');
    await process.ref.update({ documents: saved.map((item) => item.id === 'identity_document' ? { ...item, status: 'rejected' } : item),
      publicFormSubmittedAt: FieldValue.delete(), publicTokenClosedAt: FieldValue.delete(), publicTokenClosedReason: FieldValue.delete(),
      publicTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const replacement = await uploadLikeRealFlow(process.ref, 'identity_document', 'segundo', { withReading: false });
    const again = await submit(process, { identity_document: replacement }, '198.51.100.24');
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const identity = await storedDocument(process.ref, 'identity_document');
    assert.equal(identity.fileHashSha256, replacement.sha256);
    assert.equal(identity.aiAnalysis ?? null, null);
  } finally {
    await hrDbAdmin.recursiveDelete(process.ref);
  }
});

for (const kind of ['other-token', 'other-bucket', 'mismatched-url', 'private-path', 'traversal']) {
  test(`public submission refuses ${kind} before persisting browser references`, async () => {
    const process = await openProcess(`bad-${kind}`);
    try {
      const documents = {};
      for (const item of process.view.documents) documents[item.id] = await uploadLikeRealFlow(process.ref, item.id, 'valid', { withReading: false });
      const document = documents.identity_document;
      if (kind === 'other-token') document.filePath = 'hr/onboarding/other-token/private.pdf';
      if (kind === 'other-bucket') document.fileUrl = document.fileUrl.replace(globalThis.process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, 'unrelated.appspot.com');
      if (kind === 'mismatched-url') document.fileUrl = document.fileUrl.replace('.pdf?', '.different.pdf?');
      if (kind === 'private-path') document.filePath = 'financial/private-proof.pdf';
      if (kind === 'traversal') document.filePath = `hr/onboarding/${process.token}/../private.pdf`;
      const result = await submit(process, documents, `198.51.100.${30 + kind.length}`);
      assert.equal(result.status, 400, JSON.stringify(result.body));
      assert.equal(result.body.error.code, 'ONBOARDING_DOCUMENT_REFERENCE_INVALID');
      assert.equal((await process.ref.get()).get('publicFormSubmittedAt'), undefined);
      assert.deepEqual((await process.ref.get()).get('documents'), []);
    } finally { await hrDbAdmin.recursiveDelete(process.ref); }
  });
}

for (const failure of ['extraction', 'snapshot']) {
  test(`public ${failure} failure reports exactly one event with original cause`, async () => {
    const process = await openProcess(`failure-${failure}`);
    const { DocumentReference } = await import('firebase-admin/firestore');
    const { defaultErrorSink } = await import('../../src/lib/observability/error-sink.ts');
    const originalGet = DocumentReference.prototype.get, originalTransaction = hrDbAdmin.runTransaction, originalWrite = defaultErrorSink.write;
    const events = [];
    try {
      const documents = {};
      for (const item of process.view.documents) documents[item.id] = await uploadLikeRealFlow(process.ref, item.id, 'valid', { withReading: false });
      defaultErrorSink.write = event => { events.push(event); };
      if (failure === 'extraction') DocumentReference.prototype.get = function (...args) { if (this.path.includes('/documentExtractions/')) throw new Error('synthetic extraction backend failure'); return originalGet.apply(this, args); };
      else hrDbAdmin.runTransaction = async () => { throw new Error('synthetic snapshot backend failure'); };
      const result = await submit(process, documents, '198.51.100.70');
      assert.equal(result.status, 500, JSON.stringify(result.body));
      assert.equal(events.length, 1);
      assert.match(events[0].stackSanitized ?? '', /synthetic .* backend failure/);
      assert.equal(result.body.error.code, failure === 'extraction' ? 'ONBOARDING_DOCUMENT_EXTRACTION_LOAD_FAILED' : 'ONBOARDING_PRIVACY_SNAPSHOT_FAILED');
    } finally {
      DocumentReference.prototype.get = originalGet; hrDbAdmin.runTransaction = originalTransaction; defaultErrorSink.write = originalWrite;
      await hrDbAdmin.recursiveDelete(process.ref);
    }
  });
}

test('privileged attachment guard refuses legacy references from another process', async () => {
  const process = await openProcess('attachment-scope');
  const { assertOnboardingAttachmentScope } = await import('../../src/lib/hr/onboarding-attachment-scope.server.ts');
  try {
    const uploaded = await uploadLikeRealFlow(process.ref, 'identity_document', 'valid', { withReading: false });
    const data = (await process.ref.get()).data();
    await assertOnboardingAttachmentScope(process.ref.id, data, uploaded, globalThis.process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    await assert.rejects(assertOnboardingAttachmentScope(process.ref.id, data, { filePath: 'financial/private-proof.pdf' }, globalThis.process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET), { code: 'ONBOARDING_ATTACHMENT_SCOPE_UNPROVEN' });
    await assert.rejects(assertOnboardingAttachmentScope(process.ref.id, data, { filePath: 'hr/onboarding/another-private-token/private.pdf' }, globalThis.process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET), { code: 'ONBOARDING_ATTACHMENT_SCOPE_UNPROVEN' });
  } finally { await hrDbAdmin.recursiveDelete(process.ref); }
});

test('submission audit and consent history roll back together if audit cannot commit', async () => {
  const process = await openProcess('atomic-audit');
  const { Transaction } = await import('firebase-admin/firestore');
  const originalCreate = Transaction.prototype.create;
  const documents = {};
  try {
    for (const item of process.view.documents) documents[item.id] = await uploadLikeRealFlow(process.ref, item.id, 'valid', { withReading: false });
    Transaction.prototype.create = function (ref, ...args) { if (ref.path.startsWith(process.ref.path + '/audit/')) throw new Error('synthetic audit failure'); return originalCreate.call(this, ref, ...args); };
    assert.equal((await submit(process, documents, '198.51.100.80')).status, 500);
    const failed = await process.ref.get();
    assert.equal(failed.get('publicTokenClosedAt'), undefined);
    assert.equal(failed.get('publicFormSubmittedAt'), undefined);
    assert.equal((await process.ref.collection('consentimentos_imagem_voz_historico').limit(1).get()).empty, true);
    Transaction.prototype.create = originalCreate;
    assert.equal((await submit(process, documents, '198.51.100.81')).status, 200);
    const saved = await process.ref.get();
    assert.ok(saved.get('publicTokenClosedAt'));
    assert.equal((await process.ref.collection('audit').where('action', '==', 'PUBLIC_FORM_SUBMITTED').limit(2).get()).size, 1);
    assert.equal((await process.ref.collection('consentimentos_imagem_voz_historico').limit(2).get()).size, 1);
  } finally { Transaction.prototype.create = originalCreate; await hrDbAdmin.recursiveDelete(process.ref); }
});

test('signature creation claims serialize and uncertain sends never release another create', async () => {
  const { claimSignatureCreate } = await import('../../src/features/hr/documents/signature-send-safety.server.ts');
  const ref = hrDbAdmin.collection('hrSignatureRequests').doc('synthetic-uncertain-send');
  let providerCalls = 0;
  const send = async () => { if (await claimSignatureCreate(ref, { onboardingId: 'synthetic-process', status: 'prepared' })) { providerCalls++; await ref.set({ status: 'send_unconfirmed' }, { merge: true }); } };
  try {
    const first = await Promise.allSettled([send(), send()]);
    assert.equal(first.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(providerCalls, 1);
    await assert.rejects(send(), { code: 'SIGNATURE_SEND_OUTCOME_UNCONFIRMED' });
    await ref.set({ status: 'placement_ready' }, { merge: true });
    await assert.rejects(send(), { code: 'SIGNATURE_SEND_OUTCOME_UNCONFIRMED' });
    assert.equal(providerCalls, 1);
    await ref.set({ status: 'sent', providerDocumentId: 'confirmed-provider-id' }, { merge: true });
    assert.equal(await claimSignatureCreate(ref, {}), false);
    assert.equal(providerCalls, 1);
  } finally { await ref.delete(); }
});

test('changed placement revision refuses the old send before claiming an external creation', async () => {
  const { claimSignatureCreate } = await import('../../src/features/hr/documents/signature-send-safety.server.ts');
  const ref = hrDbAdmin.collection('hrSignatureRequests').doc('synthetic-revised-placement');
  try {
    await ref.set({ status: 'placement_ready', placementLayout: { revision: 1 } });
    const before = await ref.get();
    await ref.update({ placementLayout: { revision: 2 } });
    await assert.rejects(claimSignatureCreate(ref, {}, before.updateTime), { code: 'SIGNATURE_PREPARATION_CHANGED' });
    assert.equal((await ref.get()).get('sendAttemptId'), undefined);
    assert.equal(await claimSignatureCreate(ref, {}, (await ref.get()).updateTime), true);
  } finally { await ref.delete(); }
});

test('reconciliation uses a surviving provider ID to repair an incomplete local projection', async () => {
  const { freezeSignaturePersonBinding } = await import('../../src/features/privacy/signature-person-history.ts');
  const { reconcileSignatureDocuments } = await import('../../src/features/hr/documents/signature-workflow.server.ts');
  const parent = hrDbAdmin.collection('onboardingProcesses').doc('synthetic-reconcile-parent');
  const target = hrDbAdmin.collection('hrSignatureDocuments').doc('synthetic-reconcile-target');
  const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(`signature_bundle_${parent.id}`);
  const originalFetch = globalThis.fetch;
  let providerReads = 0;
  try {
    await parent.set({ candidateName: 'Synthetic person', currentStage: 'signature' });
    await target.set({ onboardingId: parent.id, selected: true, status: 'send_unconfirmed' });
    await requestRef.set(freezeSignaturePersonBinding(requestRef.id, { onboardingId: parent.id, workflowDocumentIds: [target.id], storagePath: `signature-packages/${parent.id}/immutable/pre-signature.pdf`, packageHash: 'a'.repeat(64), subjectKeys: ['hr.candidates:synthetic-candidate'], status: 'send_unconfirmed', providerDocumentId: 'synthetic-provider-confirmed', signers: [] }));
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('api.autentique.com.br')) {
        const body = JSON.parse(String(init?.body));
        assert.ok(!body.query.includes('mutation'), 'reconciliation must never create another external document'); providerReads++;
        return new Response(JSON.stringify({ data: { document: { id: 'synthetic-provider-confirmed', signatures: [], signatures_count: 0, signed_count: 0, files: { signed: null } } } }));
      }
      return originalFetch(input, init);
    };
    const previousToken = globalThis.process.env.AUTENTIQUE_API_TOKEN;
    globalThis.process.env.AUTENTIQUE_API_TOKEN = 'synthetic-reconcile-only';
    try { await reconcileSignatureDocuments({ onboardingId: parent.id }); }
    finally { if (previousToken === undefined) delete globalThis.process.env.AUTENTIQUE_API_TOKEN; else globalThis.process.env.AUTENTIQUE_API_TOKEN = previousToken; }
    assert.equal(providerReads, 1);
    const repaired = await target.get();
    assert.equal(repaired.get('providerDocumentId'), 'synthetic-provider-confirmed');
    assert.equal(repaired.get('signatureRequestId'), requestRef.id);
    assert.equal(repaired.get('status'), 'sent');
  } finally { globalThis.fetch = originalFetch; await Promise.all([hrDbAdmin.recursiveDelete(parent), target.delete(), requestRef.delete()]); }
});

test('standalone reconciliation repairs both links and refuses conflicting provider projections', async () => {
  const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
  const { freezeSignaturePersonBinding } = await import('../../src/features/privacy/signature-person-history.ts');
  const { reconcileGeneratedDocumentStandaloneSignature } = await import('../../src/features/hr/documents/signature-workflow.server.ts');
  const generated = dbAdmin.collection('generatedDocuments').doc('synthetic-standalone-recovery');
  const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(`signature_generated_${generated.id}`);
  const originalFetch = globalThis.fetch, originalToken = globalThis.process.env.AUTENTIQUE_API_TOKEN;
  let reads = 0;
  try {
    await generated.set({ status: 'final', version: 1, pdfStoragePath: 'generated-documents/synthetic/original.pdf', pdfContentHash: 'a'.repeat(64) });
    await requestRef.set(freezeSignaturePersonBinding(requestRef.id, { generatedDocumentId: generated.id, sourceGeneratedVersion: 1, sourceGeneratedHash: 'a'.repeat(64), sourceGeneratedStoragePath: 'generated-documents/synthetic/original.pdf', storagePath: 'signature-documents/synthetic/attempt/pre-signature.pdf', packageHash: 'b'.repeat(64), subjectKeys: [], status: 'send_unconfirmed', providerDocumentId: 'canonical-provider' }));
    globalThis.process.env.AUTENTIQUE_API_TOKEN = 'synthetic-only';
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('api.autentique.com.br')) { reads++; return new Response(JSON.stringify({ data: { document: { id: 'canonical-provider', signatures: [], signatures_count: 0, signed_count: 0, files: { signed: null } } } })); }
      return originalFetch(input, init);
    };
    await reconcileGeneratedDocumentStandaloneSignature(generated.id);
    const repaired = await generated.get();
    assert.equal(repaired.get('signatureRequestId'), requestRef.id); assert.equal(repaired.get('providerDocumentId'), 'canonical-provider');
    await generated.update({ providerDocumentId: 'conflicting-provider' });
    await assert.rejects(reconcileGeneratedDocumentStandaloneSignature(generated.id), /diverge/);
    assert.equal(reads, 1, 'conflict fails before provider read or archival');
  } finally { globalThis.fetch = originalFetch; if (originalToken === undefined) delete globalThis.process.env.AUTENTIQUE_API_TOKEN; else globalThis.process.env.AUTENTIQUE_API_TOKEN = originalToken; await generated.delete(); await requestRef.delete(); }
});


test('shared signature archive rejects disposed or conflicting standalone projections before file access', async () => {
  const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
  const { archiveAutentiqueSignedDocument } = await import('../../src/features/hr/documents/signature-workflow.server.ts');
  const generated = dbAdmin.collection('generatedDocuments').doc('synthetic-standalone-webhook-guard');
  const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(`signature_generated_${generated.id}`);
  const documentId = hashOf(`signed-generated-document:${generated.id}`).slice(0, 32);
  const archived = hrDbAdmin.collection('employeeDocuments').doc(documentId);
  const originalFetch = globalThis.fetch;
  let fileReads = 0;
  try {
    globalThis.fetch = async () => { fileReads++; throw new Error('unexpected signed PDF access'); };
    for (const rejected of [{ deletedAt: '2099-01-01' }, { status: 'discarded' }, { status: 'cancelled' }, { archiveStatus: 'disposed' }, { signatureRequestId: 'another-request' }, { providerDocumentId: 'another-provider' }]) {
      await generated.set({ status: 'final', ...rejected });
      await requestRef.set({ generatedDocumentId: generated.id, providerDocumentId: 'canonical-provider', status: 'sent', subjectKeys: ['hr.employees:synthetic-person'], employeeId: 'synthetic-person' });
      await assert.rejects(archiveAutentiqueSignedDocument({ signatureRequestId: requestRef.id, signedUrl: 'https://api.autentique.com.br/synthetic-signed.pdf' }), /removido|descartado|diverge/);
      assert.equal((await requestRef.get()).get('status'), 'sent');
      assert.equal((await requestRef.get()).get('archivedDocumentId'), undefined);
      assert.equal((await archived.get()).exists, false);
    }
    assert.equal(fileReads, 0, 'all rejection paths precede signed PDF download and Storage writes');
  } finally { globalThis.fetch = originalFetch; await Promise.all([generated.delete(), requestRef.delete(), hrDbAdmin.recursiveDelete(archived)]); }
});
