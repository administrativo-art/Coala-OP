import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { createHash, createHmac } from "node:crypto";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
import { enableServerOnlyTestImports } from "../helpers/server-only-runtime.mjs";

assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
process.env.DP_ABSENCE_CATALOG_DATABASE = "coala-rh";
enableServerOnlyTestImports("demo-coala-repository");
const { authAdmin, dbAdmin, adminApp } = await import("../../src/lib/firebase-admin.ts");
const { hrDbAdmin } = await import("../../src/lib/firebase-rh-admin.ts");
const { financialDbAdmin } = await import("../../src/lib/firebase-financial-admin.ts");
const { ingestFinancialEmail } = await import("../../src/features/financial/inbox/ingest.server.ts");
const { analyzeFinancialInboxMessage } = await import("../../src/features/financial/inbox/workflow.server.ts");
const { classifyFinancialEmail } = await import("../../src/features/financial/inbox/parser.ts");
const work = await import("../../src/app/api/documents/work-items/route.ts");
const history = await import("../../src/app/api/documents/history/route.ts");
const generated = await import("../../src/app/api/documents/generated/route.ts");
const folder = await import("../../src/app/api/documents/company/folder/route.ts");
const employeeAccess = await import("../../src/app/api/hr/employee-documents/access/route.ts");
const employeeDocuments = await import("../../src/app/api/hr/employee-documents/route.ts");
const intake = await import("../../src/app/api/documents/company/intake/route.ts");
const companyUnits = await import("../../src/app/api/documents/company/units/route.ts");
const financialNaming = await import("../../src/app/api/financial/inbox/[id]/files/[fileId]/naming/route.ts");
const financialFile = await import("../../src/app/api/financial/inbox/[id]/files/[fileId]/route.ts");
const counterparties = await import("../../src/app/api/financial/document-counterparties/route.ts");
const invoiceDestination = await import("../../src/app/api/financial/inbox/[id]/files/[fileId]/destination/route.ts");
const assetInvoice = await import("../../src/app/api/assets/[assetId]/inbox-invoices/[messageId]/[fileId]/route.ts");
const assetLookup = await import("../../src/app/api/assets/lookup/route.ts");
const autentique = await import("../../src/lib/autentique.server.ts");
const autentiqueWebhook = await import("../../src/app/api/webhooks/autentique/route.ts");
const uid = "central-integration-reader";
const profileId = `${uid}-profile`;
const employeeId = `${uid}-employee`;

test("kit assinado arquiva uma vez antes ou depois da ativação e suporta retorno repetido", async (t) => {
  const { archiveAutentiqueSignedDocument, promoteSignedOnboardingDocuments } = await import("../../src/features/hr/documents/signature-workflow.server.ts");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const originalFetch = globalThis.fetch;
  const signedUrl = "https://api.autentique.com.br/synthetic-signed-kit.pdf";
  globalThis.fetch = async (input, init) => String(input) === signedUrl ? new Response(bytes, { headers: { "Content-Type": "application/pdf" } }) : originalFetch(input, init);
  const refs = [], paths = [];
  const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await Promise.all(refs.map((ref) => hrDbAdmin.recursiveDelete(ref)));
    await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
  });
  for (const alreadyActive of [false, true]) {
    const onboardingId = `signed-kit-${alreadyActive ? "active" : "pending"}`;
    const person = `${onboardingId}-employee`;
    const requestId = `signature_bundle_${onboardingId}`;
    const processRef = hrDbAdmin.collection("onboardingProcesses").doc(onboardingId);
    const requestRef = hrDbAdmin.collection("hrSignatureRequests").doc(requestId);
    const workflows = ["contract", "privacy"].map((templateId, index) => ({ id: `${onboardingId}-${index}`, templateId }));
    const workflowRefs = workflows.map((workflow) => hrDbAdmin.collection("hrSignatureDocuments").doc(workflow.id));
    const archiveId = createHash("sha256").update(`signed-admission-package:${requestId}`).digest("hex").slice(0, 32);
    const archiveRef = hrDbAdmin.collection("employeeDocuments").doc(archiveId);
    refs.push(processRef, requestRef, ...workflowRefs, archiveRef);
    const signedPath = `signed-documents/${onboardingId}/${requestId}/${contentHash}/signed.pdf`;
    const permanentPath = signedPath;
    paths.push(signedPath, permanentPath);
    await processRef.set({ candidateName: "Pessoa sintética", expectedAdmissionDate: "2099-01-01", currentStage: "completed", ...(alreadyActive ? { employeeId: person } : {}) });
    await requestRef.set({ onboardingId, status: "sent", providerDocumentId: `provider-${onboardingId}`, documentName: "Coala Shakes - RH | Admissão - Pessoa sintética", workflowDocumentIds: workflows.map((workflow) => workflow.id), manifest: { schemaVersion: 1, packageType: "admission", components: [...workflows.map(({ templateId }) => ({ templateId })), { templateId: "system-admission-bundle-closing-term" }] } });
    await Promise.all(workflowRefs.map((ref, index) => ref.set({ onboardingId, signatureRequestId: requestId, selected: true, status: "sent", documentTypeCode: "ADMISSION_DOCUMENT", templateId: workflows[index].templateId })));
    const first = await archiveAutentiqueSignedDocument({ signatureRequestId: requestId, signedUrl });
    if (!alreadyActive) {
      assert.equal(first, null); assert.equal((await archiveRef.get()).exists, false);
      await processRef.update({ employeeId: person });
      await bucket.file(signedPath).save(Buffer.from("%PDF-conteúdo divergente"), { resumable: false });
      await assert.rejects(promoteSignedOnboardingDocuments({ onboardingId, employeeId: person }), /hash assinado/);
      assert.equal((await archiveRef.get()).exists, false);
      await bucket.file(signedPath).save(bytes, { resumable: false });
      assert.deepEqual(await promoteSignedOnboardingDocuments({ onboardingId, employeeId: person }), [archiveId]);
    } else assert.equal(first, archiveId);
    assert.equal(await archiveAutentiqueSignedDocument({ signatureRequestId: requestId, signedUrl }), archiveId);
    assert.deepEqual(await promoteSignedOnboardingDocuments({ onboardingId, employeeId: person }), [archiveId]);
    const archived = await archiveRef.get();
    assert.equal(archived.get("documentTypeCode"), "ADMISSION_PACKAGE");
    assert.equal(archived.get("contentHash"), contentHash);
    assert.equal(archived.get("storagePath"), permanentPath);
    assert.equal(archived.get("employeeId"), person);
    assert.equal((await hrDbAdmin.collection("employeeDocuments").where("sourceOnboardingId", "==", onboardingId).limit(10).get()).size, 1);
    for (const ref of workflowRefs) assert.equal((await ref.get()).get("employeeDocumentId"), archiveId);
    assert.equal((await requestRef.get()).get("archivedDocumentId"), archiveId);
    assert.equal((await requestRef.get()).get("signedStoragePath"), archived.get("storagePath"));
    const [copies] = await bucket.getFiles({ prefix: `hr/employee-documents/${person}/documents/${archiveId}/`, autoPaginate: false, maxResults: 10 });
    assert.equal(copies.length, 0, "arquivar deve reutilizar o PDF assinado, sem criar cópia física");
    assert.equal(createHash("sha256").update((await bucket.file(permanentPath).download())[0]).digest("hex"), contentHash);
    assert.equal((await archiveRef.collection("audit").where("action", "==", "SIGNED_DOCUMENT_ARCHIVED").get()).size, 1);
  }
});

test("assinatura individual da admissão também reutiliza o arquivo e valida seu hash", async (t) => {
  const { promoteSignedOnboardingDocuments } = await import("../../src/features/hr/documents/signature-workflow.server.ts");
  const onboardingId = "single-storage-independent", employeeId = "single-storage-independent-person", workflowId = "single-storage-independent-workflow";
  const requestId = "single-storage-independent-request";
  const workflow = hrDbAdmin.collection("hrSignatureDocuments").doc(workflowId);
  const processRef = hrDbAdmin.collection("onboardingProcesses").doc(onboardingId);
  const request = hrDbAdmin.collection("hrSignatureRequests").doc(requestId);
  const documentId = createHash("sha256").update(`signed-signature:${workflowId}`).digest("hex").slice(0, 32);
  const document = hrDbAdmin.collection("employeeDocuments").doc(documentId);
  const path = `signed-documents/${onboardingId}/${requestId}/signed.pdf`;
  const bytes = Buffer.from("%PDF-assinatura-individual-sintetica"), hash = createHash("sha256").update(bytes).digest("hex");
  const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  t.after(async () => { await Promise.all([workflow, processRef, request, document].map((ref) => hrDbAdmin.recursiveDelete(ref))); await bucket.file(path).delete({ ignoreNotFound: true }); });
  await processRef.set({ candidateName: "Pessoa sintética", employeeId, expectedAdmissionDate: "2099-01-01" });
  await request.set({ onboardingId, status: "signed", signedStoragePath: path });
  await workflow.set({ onboardingId, signatureRequestId: requestId, status: "signed", selected: true, signedStoragePath: path, signedHash: "0".repeat(64), documentTypeCode: "EMPLOYMENT_CONTRACT", providerDocumentId: "synthetic-independent" });
  await bucket.file(path).save(bytes, { resumable: false });
  await assert.rejects(promoteSignedOnboardingDocuments({ onboardingId, employeeId }), /hash assinado/);
  assert.equal((await document.get()).exists, false);
  await workflow.update({ signedHash: hash });
  assert.deepEqual(await promoteSignedOnboardingDocuments({ onboardingId, employeeId }), [documentId]);
  assert.equal((await document.get()).get("storagePath"), path);
  assert.equal((await document.get()).get("contentHash"), hash);
  const [copies] = await bucket.getFiles({ prefix: `hr/employee-documents/${employeeId}/documents/${documentId}/`, autoPaginate: false, maxResults: 10 });
  assert.equal(copies.length, 0);
});

test("callbacks concorrentes com conteúdos distintos não sobrescrevem o original arquivado", async (t) => {
  const { archiveAutentiqueSignedDocument } = await import("../../src/features/hr/documents/signature-workflow.server.ts");
  const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const refs = [], files = [];
  const originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await Promise.all(refs.map(([db, ref]) => db.recursiveDelete(ref))); await Promise.all(files.map((path) => bucket.file(path).delete({ ignoreNotFound: true }))); });
  for (const mode of ["individual", "generated"]) {
    const contextId = `single-storage-race-${mode}`, person = `${contextId}-person`, requestId = `${contextId}-request`;
    const generatedId = `${contextId}-generated`, workflowId = `${contextId}-workflow`;
    const request = hrDbAdmin.collection("hrSignatureRequests").doc(requestId);
    const documentId = createHash("sha256").update(mode === "individual" ? `signed-signature:${workflowId}` : `signed-generated-document:${generatedId}`).digest("hex").slice(0, 32);
    const document = hrDbAdmin.collection("employeeDocuments").doc(documentId);
    refs.push([hrDbAdmin, request], [hrDbAdmin, document]);
    if (mode === "individual") {
      const processRef = hrDbAdmin.collection("onboardingProcesses").doc(contextId), workflow = hrDbAdmin.collection("hrSignatureDocuments").doc(workflowId);
      refs.push([hrDbAdmin, processRef], [hrDbAdmin, workflow]);
      await processRef.set({ candidateName: "Pessoa sintética", employeeId: person, currentStage: "completed" });
      await workflow.set({ onboardingId: contextId, signatureRequestId: requestId, status: "sent", selected: true, documentTypeCode: "EMPLOYMENT_CONTRACT", providerDocumentId: "synthetic-race" });
      await request.set({ onboardingId: contextId, workflowDocumentIds: [workflowId], status: "sent", providerDocumentId: "synthetic-race" });
    } else {
      const generatedRef = dbAdmin.collection("generatedDocuments").doc(generatedId); refs.push([dbAdmin, generatedRef]);
      await generatedRef.set({ employeeId: person, documentTypeCode: "VACATION_RECEIPT", templateName: "Recibo sintético", status: "final" });
      await request.set({ generatedDocumentId: generatedId, employeeId: person, documentTypeCode: "VACATION_RECEIPT", status: "sent", providerDocumentId: "synthetic-race" });
    }
    const bodies = [Buffer.from(`%PDF-conteudo-A-${mode}`), Buffer.from(`%PDF-conteudo-B-${mode}`)];
    const urls = bodies.map((_, index) => `https://api.autentique.com.br/${contextId}-${index}.pdf`);
    let arrivals = 0, release;
    const ready = new Promise((resolve) => { release = resolve; });
    globalThis.fetch = async (input, init) => {
      const index = urls.indexOf(String(input));
      if (index < 0) return originalFetch(input, init);
      if (++arrivals === 2) release();
      await ready; return new Response(bodies[index], { headers: { "Content-Type": "application/pdf" } });
    };
    for (const bytes of bodies) { const hash = createHash("sha256").update(bytes).digest("hex"); files.push(mode === "individual" ? `signed-documents/${contextId}/${requestId}/${hash}/signed.pdf` : `signed-documents/generated/${generatedId}/${requestId}/${hash}/signed.pdf`); }
    const outcomes = await Promise.allSettled(urls.map((signedUrl) => archiveAutentiqueSignedDocument({ signatureRequestId: requestId, signedUrl })));
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.match(outcomes.find((result) => result.status === "rejected").reason.message, /diverge/);
    const stored = await document.get(), signedPath = stored.get("storagePath");
    assert.ok(signedPath.includes(stored.get("contentHash")));
    assert.equal(createHash("sha256").update((await bucket.file(signedPath).download())[0]).digest("hex"), stored.get("contentHash"));
    assert.equal((await request.get()).get("signedStoragePath"), signedPath);
    if (mode === "generated") assert.equal((await dbAdmin.collection("generatedDocuments").doc(generatedId).get()).get("signedStoragePath"), signedPath);
  }
});

test("recepção concorrente exige claim antes do arquivo e callback repetido é idempotente", async (t) => {
  const emailId = `claim-synthetic-${Date.now()}`;
  const claim = financialDbAdmin.collection("financialInboxIngestClaims").doc(emailId);
  const message = financialDbAdmin.collection("financialInboxMessages").doc(emailId);
  const rawPath = `financial-inbox/coala/${emailId}/original.eml`;
  const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  t.after(async () => { const events = await message.collection("events").get(); await Promise.all(events.docs.map((entry) => entry.ref.delete())); await message.delete(); await claim.delete(); await bucket.file(rawPath).delete({ ignoreNotFound: true }); });
  const rawUrl = `https://resend.com/synthetic/${emailId}`;
  const input = { eventId: `event-${emailId}`, eventAt: "2026-11-03T00:00:00.000Z", emailId, apiKey: "synthetic", received: { from: "newsletter@example.com", to: ["financeiro@example.com"], subject: "Promoção da semana", text: "Oferta comercial sem cobrança", attachments: [], raw: { download_url: rawUrl } } };
  const priorFetch = globalThis.fetch;
  let enterDownload, releaseDownload;
  const entered = new Promise((resolve) => { enterDownload = resolve; });
  const gate = new Promise((resolve) => { releaseDownload = resolve; });
  globalThis.fetch = (url, options) => String(url) === rawUrl ? (enterDownload(), gate.then(() => new Response(Buffer.from("From: newsletter@example.com\r\nSubject: Promoção\r\n\r\nOferta")))) : priorFetch(url, options);
  let first;
  try {
    const original = ingestFinancialEmail(input);
    await entered;
    await assert.rejects(ingestFinancialEmail(input), /aguarda conclusão ou reconciliação/);
    assert.equal((await message.get()).exists, false);
    releaseDownload();
    first = await original;
  } finally { releaseDownload(); globalThis.fetch = priorFetch; }
  assert.equal(first.duplicate, false);
  assert.equal((await claim.get()).get("state"), "completed");
  assert.equal((await ingestFinancialEmail(input)).duplicate, true);
});

test("gravação incerta de anexo segura claim, espera anexos paralelos e exige censo antes de retry", async (t) => {
  const emailId = `claim-uncertain-${Date.now()}`, base = `financial-inbox/coala/${emailId}`;
  const claim = financialDbAdmin.collection("financialInboxIngestClaims").doc(emailId);
  const message = financialDbAdmin.collection("financialInboxMessages").doc(emailId);
  const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  t.after(async () => { const [objects] = await bucket.getFiles({ prefix: `${base}/`, autoPaginate: false, maxResults: 20 }); await Promise.all(objects.map((object) => object.delete({ ignoreNotFound: true }))); const events = await message.collection("events").get(); await Promise.all(events.docs.map((entry) => entry.ref.delete())); await message.delete(); await claim.delete(); });
  const attachments = [0, 1].map((index) => ({ id: `file${index}`, filename: `anexo${index}.pdf`, content_type: "application/pdf", size: 12 }));
  const input = { eventId: `event-${emailId}`, eventAt: "2026-11-03T00:00:00.000Z", emailId, apiKey: "synthetic", received: { from: "newsletter@example.com", to: ["financeiro@example.com"], subject: "Promoção da semana", text: "Oferta comercial", attachments } };
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    const value = String(url);
    if (value.startsWith(`https://api.resend.com/emails/receiving/${emailId}/attachments/`)) return Promise.resolve(new Response(JSON.stringify({ download_url: `https://resend.com/synthetic/${value.split("/").at(-1)}` }), { headers: { "Content-Type": "application/json" } }));
    if (value.startsWith("https://resend.com/synthetic/file")) return Promise.resolve(new Response(Buffer.from(`%PDF-${value.split("/").at(-1)}`)));
    return priorFetch(url, options);
  };
  const prototype = Object.getPrototypeOf(bucket.file(`${base}/attachments/file0-anexo0.pdf`)), originalSave = prototype.save;
  let failedAfterSave = false;
  prototype.save = async function (...args) { const result = await originalSave.apply(this, args); if (this.name === `${base}/attachments/file0-anexo0.pdf` && !failedAfterSave) { failedAfterSave = true; throw new Error("synthetic uncertain storage save"); } return result; };
  try { await assert.rejects(ingestFinancialEmail(input), /resultado incerto/); } finally { prototype.save = originalSave; globalThis.fetch = priorFetch; }
  assert.equal(failedAfterSave, true);
  assert.equal((await message.get()).exists, false);
  const held = await claim.get();
  assert.equal(held.get("state"), "reconciliation_required");
  assert.equal(held.get("plannedObjects").length, 2);
  await assert.rejects(ingestFinancialEmail({ ...input, received: { ...input.received, attachments: [] } }), /aguarda conclusão ou reconciliação/);
  // Demo-only rehearsal of the documented manual recovery after both producers have ended.
  for (const planned of held.get("plannedObjects")) {
    const object = bucket.file(planned.path);
    const [meta] = await object.getMetadata();
    assert.equal(meta.metadata.sha256, planned.sha256);
    await object.delete({ ifGenerationMatch: meta.generation });
  }
  assert.equal((await bucket.getFiles({ prefix: `${base}/`, autoPaginate: false, maxResults: 20 }))[0].length, 0);
  await claim.delete({ lastUpdateTime: held.updateTime });
  assert.equal((await ingestFinancialEmail({ ...input, received: { ...input.received, attachments: [] } })).duplicate, false);
});

test("central: autorização atual, paginação e proposta preservadas pelas APIs", async (t) => {
  const refs = [];
  const seed = async (db, collection, id, data) => {
    const ref = db.collection(collection).doc(id);
    refs.push(ref);
    await ref.set(data);
    return ref;
  };
  t.after(async () => {
    await Promise.all(refs.map((ref) => ref.delete()));
    await authAdmin.deleteUser(uid).catch(() => undefined);
  });
  const permissions = { hr: { formalization: { documents: { view: true }, signatures: { view: true }, companyDocuments: { view: false } } }, dp: { collaborators: { view: true, edit: true }, rh_role: "manager" } };
  const profile = await seed(dbAdmin, "profiles", profileId, { permissions });
  await authAdmin.createUser({ uid, email: `${uid}@example.test`, password: "synthetic-test-password" });
  await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
  await seed(dbAdmin, "users", uid, { username: "Central Reader", email: `${uid}@example.test`, profileId, isActive: true, sessionVersion: 0, unitAccessScope: "selected", unitAccessUnitIds: ["central-unit-a"], profileCompliance: { status: "complete", policyVersion: 1 } });
  const person = await seed(dbAdmin, "users", employeeId, { unitIds: ["central-unit-a"] });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.match(host ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
  const signIn = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@example.test`, password: "synthetic-test-password", returnSecureToken: true }) });
  assert.equal(signIn.ok, true);
  const { idToken } = await signIn.json();
  const authRoutes = (token) => [
    assetLookup.GET(new NextRequest("http://localhost/api/assets/lookup?code=PAT-000001", { headers: token ? { Authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({}) }),
    assetInvoice.GET(new NextRequest("http://localhost/api/assets/a/inbox-invoices/m/f", { headers: token ? { Authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({ assetId: "a", messageId: "m", fileId: "f" }) }),
    invoiceDestination.POST(new NextRequest("http://localhost/api/financial/inbox/m/files/f/destination", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ kind: "non_asset_invoice", assetIds: [], expectedSha256: "0".repeat(64) }) }), { params: Promise.resolve({ id: "m", fileId: "f" }) }),
    invoiceDestination.DELETE(new NextRequest("http://localhost/api/financial/inbox/m/files/f/destination", { method: "DELETE", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: "0".repeat(64), expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: "m", fileId: "f" }) }),
  ];
  assert.deepEqual((await Promise.all(authRoutes(null))).map((response) => response.status), [401, 401, 401, 401]);
  await dbAdmin.collection("users").doc(uid).update({ isActive: false });
  assert.deepEqual((await Promise.all(authRoutes(idToken))).map((response) => response.status), [403, 403, 403, 403]);
  await dbAdmin.collection("users").doc(uid).update({ isActive: true });
  await t.test("projeção RH publicada pagina mesmo com página filtrada vazia e mantém unidade", async () => {
    const base = { employeeId, category:"admission", documentTypeCode:"ADMISSION_PACKAGE", storagePath:"private/fixture.pdf",
      publication:{status:"published",at:"2026-11-03",by:uid,source:"manual"}, deletedAt:null };
    await seed(hrDbAdmin,"employeeDocuments",`${uid}-page-a`,{...base,deletedAt:"2026-11-03"});
    await seed(hrDbAdmin,"employeeDocuments",`${uid}-page-b`,base);
    await seed(hrDbAdmin,"employeeDocuments",`${uid}-page-c`,base);
    const read = (params) => employeeDocuments.GET(new NextRequest(`http://localhost/api/hr/employee-documents?${new URLSearchParams({employeeId,publishedOnly:"1",limit:"1",...params})}`, {headers:{Authorization:`Bearer ${idToken}`}}));
    const first = await read({}); assert.equal(first.status,200);
    const firstPage = await first.json(); assert.equal(firstPage.documents.length,0); assert.ok(firstPage.nextCursor);
    const second = await read({cursor:firstPage.nextCursor}); assert.equal(second.status,200);
    const secondPage = await second.json(); assert.deepEqual(secondPage.documents.map(doc => doc.id),[`${uid}-page-b`]); assert.ok(secondPage.nextCursor);
    const third = await read({cursor:secondPage.nextCursor}); assert.equal(third.status,200);
    const thirdPage = await third.json(); assert.deepEqual(thirdPage.documents.map(doc => doc.id),[`${uid}-page-c`]); assert.equal(thirdPage.nextCursor,null);
    assert.equal((await read({limit:"101"})).status,400);
    assert.equal((await read({cursor:"bad/cursor"})).status,400);
    await person.update({unitIds:["central-unit-b"]});
    assert.equal((await read({})).status,403);
    await person.update({unitIds:["central-unit-a"]});
  });
  await t.test("remover assinado do Acervo preserva o original compartilhado e revalida gestão/unidade", async () => {
    const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    const path = `central-integration/${uid}/shared-signed.pdf`;
    const bytes = Buffer.from("%PDF-original-assinado-sintetico");
    await bucket.file(path).save(bytes, { resumable: false });
    t.after(() => bucket.file(path).delete({ ignoreNotFound: true }));
    const document = await seed(hrDbAdmin, "employeeDocuments", `${uid}-shared-signed`, { employeeId, category: "admission", documentTypeCode: "ADMISSION_PACKAGE", storagePath: path, storageSubfolder: "private-source-namespace", signedFileUrl: "https://api.autentique.com.br/private-test.pdf", source: "autentique_signature", signatureStatus: "signed", deletedAt: null });
    const request = await seed(hrDbAdmin, "hrSignatureRequests", `${uid}-shared-signed-request`, { employeeId, signedStoragePath: path, archivedDocumentId: document.id, status: "signed" });
    const remove = (authenticated = true) => employeeDocuments.DELETE(new NextRequest(`http://localhost/api/hr/employee-documents?id=${document.id}`, { method: "DELETE", headers: authenticated ? { Authorization: `Bearer ${idToken}` } : {} }));
    const listing = await employeeDocuments.GET(new NextRequest(`http://localhost/api/hr/employee-documents?employeeId=${employeeId}`, { headers: { Authorization: `Bearer ${idToken}` } }));
    assert.equal(listing.status, 200);
    const listed = (await listing.json()).documents.find((item) => item.id === document.id);
    assert.ok(listed);
    for (const field of ["storagePath", "storageSubfolder", "signedFileUrl"]) assert.equal(field in listed, false, "a lista não deve expor caminhos ou links privados");
    assert.equal((await remove(false)).status, 403);
    await person.update({ unitIds: ["central-unit-b"] });
    assert.equal((await remove()).status, 403);
    assert.equal((await document.get()).get("deletedAt"), null);
    await person.update({ unitIds: ["central-unit-a"] });
    const result = await remove();
    assert.equal(result.status, 200); assert.equal((await result.json()).storageRetained, true);
    assert.ok((await document.get()).get("deletedAt"));
    assert.equal((await document.get()).get("storagePath"), path);
    assert.equal((await request.get()).get("signedStoragePath"), path);
    assert.deepEqual((await bucket.file(path).download())[0], bytes);
    assert.equal((await remove()).status, 200);
    assert.equal((await document.collection("audit").where("action", "==", "DOCUMENT_REMOVED_FROM_ARCHIVE").limit(10).get()).size, 1);
    const plainPath = `central-integration/${uid}/unsigned-upload.pdf`;
    await bucket.file(plainPath).save(bytes, { resumable: false });
    t.after(() => bucket.file(plainPath).delete({ ignoreNotFound: true }));
    const plain = await seed(hrDbAdmin, "employeeDocuments", `${uid}-unsigned-upload`, { employeeId, storagePath: plainPath, source: "upload", signatureStatus: "not_required" });
    assert.equal((await employeeDocuments.DELETE(new NextRequest(`http://localhost/api/hr/employee-documents?id=${plain.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } }))).status, 200);
    assert.equal((await bucket.file(plainPath).exists())[0], false);
  });
  const unauthenticated = await work.GET(new NextRequest("http://localhost/api/documents/work-items?tab=classify"), { params: Promise.resolve({}) });
  assert.equal(unauthenticated.status, 401);
  const call = async (route, path, params) => {
    const response = await route.GET(new NextRequest(`http://localhost${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({}) });
    return { status: response.status, body: await response.json() };
  };
  for (let index = 0; index < 4; index++) await seed(dbAdmin, "generatedDocuments", `${uid}-generated-${index}`, {
    generatedAt: `2099-01-0${4 - index}T00:00:00.000Z`, status: "final", signatureStatus: index < 3 ? "signed" : "sent", templateName: "Contrato sintético",
  });
  const first = await call(work, "/api/documents/work-items", { tab: "signatures", source: "generated", limit: "2" });
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 0);
  assert.equal(first.body.continuations.length, 1, JSON.stringify(first.body));
  const cursor = first.body.continuations[0].cursor;
  const second = await call(work, "/api/documents/work-items", { tab: "signatures", source: "generated", limit: "2", cursor });
  assert.equal(second.status, 200);
  await seed(hrDbAdmin, "onboardingProcesses", `${uid}-signature-process`, { unitId: "central-unit-a", candidateName: "Titular autorizado" });
  await seed(hrDbAdmin, "onboardingProcesses", `${uid}-signature-restricted-process`, { unitId: "central-unit-b", candidateName: "Titular vedado" });
  await seed(hrDbAdmin, "hrSignatureRequests", `${uid}-admission-signature`, { onboardingId: `${uid}-signature-process`, status: "sent", provider: "autentique", documentName: "Kit admissional", participants: { employee: { emailDeliveredAt: "2026-11-02", email: "secret@example.test", signatureUrl: "private-link" } } });
  await seed(hrDbAdmin, "hrSignatureRequests", `${uid}-admission-signature-denied`, { onboardingId: `${uid}-signature-restricted-process`, status: "sent", documentName: "Kit vedado" });
  const admissionSignatures = await call(work, "/api/documents/work-items", { tab: "signatures", source: "onboarding" });
  assert.equal(admissionSignatures.status, 200);
  assert.equal(admissionSignatures.body.items.length, 1, JSON.stringify(admissionSignatures.body));
  assert.equal(admissionSignatures.body.items[0].metadata.provider, "Autentique");
  assert.equal(JSON.stringify(admissionSignatures.body).includes("secret@example.test"), false);
  assert.equal(JSON.stringify(admissionSignatures.body).includes("Kit vedado"), false);
  await hrDbAdmin.collection("onboardingProcesses").doc(`${uid}-signature-process`).update({ unitId: "central-unit-b" });
  assert.equal((await call(work, "/api/documents/work-items", { tab: "signatures", source: "onboarding" })).body.items.length, 0);
  assert.ok(second.body.items.some((item) => item.documentRef.sourceId === `${uid}-generated-3`));
  assert.equal((await call(work, "/api/documents/work-items", { tab: "signatures", cursor })).status, 400);
  await seed(dbAdmin, "generatedDocuments", `${uid}-old-discarded`, {
    status: "discarded", generatedAt: "2000-01-01T00:00:00.000Z", storagePath: "private/source.docx", pdfStoragePath: "private/source.pdf", manualValues: { confidential: "hidden" },
    parties: [{ snapshot: { name: "Pessoa", signatureEmail: "private@example.test" } }],
  });
  const selectedOld = await call(generated, "/api/documents/generated", { documentId: `${uid}-old-discarded`, includeDiscarded: "true" });
  assert.equal(selectedOld.status, 200);
  assert.deepEqual(selectedOld.body.documents.map((doc) => doc.id), [`${uid}-old-discarded`]);
  assert.equal(selectedOld.body.documents[0].storagePath, undefined);
  assert.equal(selectedOld.body.documents[0].manualValues, undefined);
  assert.equal(selectedOld.body.documents[0].parties[0].snapshot.signatureEmail, undefined);
  assert.equal((await call(generated, "/api/documents/generated", { documentId: `${uid}-old-discarded` })).body.documents.length, 0);
  assert.equal((await call(generated, "/api/documents/generated", { documentId: "missing" })).body.documents.length, 0);

  await seed(hrDbAdmin, "documentUploadBatches", `${uid}-batch`, { createdBy: uid, employeeId, status: "AWAITING_REVIEW" });
  for (let index = 0; index < 3; index++) await seed(hrDbAdmin, "documentUploadItems", `${uid}-item-${index}`, {
    batchId: `${uid}-batch`, employeeId, status: "ready", originalName: "original.pdf", documentTypeCode: "EMPLOYMENT_CONTRACT", category: "contracts",
    destination: { downloadName: "Contrato-sugerido.pdf", pathSegments: ["Contratos"] }, createdAt: "2026-11-02T00:00:00.000Z",
  });
  const uploads = await call(work, "/api/documents/work-items", { tab: "classify", source: "employee_upload", limit: "2" });
  assert.equal(uploads.status, 200);
  assert.equal(uploads.body.items.length, 2);
  assert.equal(uploads.body.continuations.length, 1);
  const nextUploads = await call(work, "/api/documents/work-items", { tab: "classify", source: "employee_upload", limit: "2", cursor: uploads.body.continuations[0].cursor });
  assert.equal(nextUploads.body.items.length, 1);
  assert.ok(!uploads.body.items.some((item) => item.id === nextUploads.body.items[0].id));
  const uploadHistory = await call(history, "/api/documents/history", { source: "employee_upload", limit: "2" });
  assert.equal(uploadHistory.body.entries[0].appliedName, null);
  assert.equal(uploadHistory.body.entries[0].recordKind, "current_snapshot");
  assert.match(uploadHistory.body.entries[0].detail, /não confirmada/);
  const historyNext = await call(history, "/api/documents/history", { source: "employee_upload", limit: "2", cursor: uploadHistory.body.continuations[0].cursor });
  assert.equal(historyNext.body.entries.length, 1);
  await seed(dbAdmin, "users", `${uid}-restricted-person`, { unitIds: ["central-unit-b"] });
  await seed(hrDbAdmin, "documentUploadBatches", `${uid}-team-batch`, { createdBy: "another-manager", employeeId, status: "AWAITING_REVIEW" });
  await seed(hrDbAdmin, "documentUploadItems", `${uid}-team-item`, { batchId: `${uid}-team-batch`, employeeId, status: "ready", documentTypeCode: "EMPLOYMENT_CONTRACT", category: "contracts", originalName: "Equipe autorizada.pdf" });
  await seed(hrDbAdmin, "documentUploadItems", `${uid}-team-restricted`, { batchId: `${uid}-team-batch`, employeeId: `${uid}-restricted-person`, status: "ready", documentTypeCode: "EMPLOYMENT_CONTRACT", category: "contracts", originalName: "Nome restrito que não pode sair.pdf" });
  let teamCursor = uploads.body.continuations[0].cursor;
  const teamItems = [];
  for (let pages = 0; teamCursor && pages < 5; pages++) {
    const page = await call(work, "/api/documents/work-items", { tab: "classify", source: "employee_upload", limit: "2", cursor: teamCursor });
    teamItems.push(...page.body.items);
    teamCursor = page.body.continuations[0]?.cursor;
  }
  assert.ok(teamItems.some((item) => item.metadata.originalName === "Equipe autorizada.pdf"));
  assert.equal(JSON.stringify(teamItems).includes("Nome restrito"), false);

  // Storage é obrigatoriamente emulado antes de qualquer acesso ao binário.
  assert.match(process.env.STORAGE_EMULATOR_HOST ?? "", /^(https?:\/\/)?(127\.0\.0\.1|localhost):\d+$/);
  const binary = Buffer.from("%PDF-1.4 synthetic fixture");
  const file = getStorage(adminApp).bucket("demo-coala-repository.appspot.com").file(`${uid}/document.pdf`);
  t.after(() => file.delete({ ignoreNotFound: true }));
  await file.save(binary);
  const filed = await seed(hrDbAdmin, "employeeDocuments", `${uid}-download`, {
    employeeId, documentTypeCode: "EMPLOYMENT_CONTRACT", category: "contracts", storedName: "MAT-001__CONTRATO__v01", originalName: "nome-antigo.pdf", mimeType: "application/pdf", storagePath: file.name,
  });
  const openEmployee = (action) => employeeAccess.POST(new NextRequest("http://localhost/api/hr/employee-documents/access", { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: filed.id, action }) }), { params: Promise.resolve({}) });
  t.after(async () => {
    const audit = await filed.collection("audit").get();
    await Promise.all(audit.docs.map((doc) => doc.ref.delete()));
  });
  const download = await openEmployee("download");
  assert.equal(download.status, 200);
  assert.match(download.headers.get("Content-Disposition"), /MAT-001__CONTRATO__v01\.pdf/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), binary);
  assert.equal((await filed.get()).get("originalName"), "nome-antigo.pdf");
  assert.equal((await filed.collection("audit").where("action", "==", "downloaded").get()).size, 1);
  assert.equal((await openEmployee("invalid-action")).status, 400);

  const uploadItemRef = hrDbAdmin.collection("documentUploadItems").doc(`${uid}-item-0`);
  await uploadItemRef.update({ filedDocumentId: filed.id });
  await seed(hrDbAdmin, `${uploadItemRef.path}/audit`, "analysis", { action: "ITEM_ANALYZED", at: "2026-11-02T01:00:00.000Z", actorId: uid, analysisMethod: "ocr", originalName: "original.pdf", rawOcr: "clinical-secret-not-for-central" });
  await seed(hrDbAdmin, `${uploadItemRef.path}/audit`, "correction", { action: "ITEM_CORRECTED", at: "2026-11-02T02:00:00.000Z", actorId: uid, appliedName: "Nome-confirmado.pdf" });
  const auditPage = await call(history, "/api/documents/history", { source: "employee_upload", documentId: uploadItemRef.id, limit: "2" });
  assert.equal(auditPage.status, 200);
  assert.ok(auditPage.body.entries.some((entry) => entry.eventLabel === "Documento baixado"));
  assert.equal(JSON.stringify(auditPage.body).includes("clinical-secret"), false);
  assert.ok(auditPage.body.continuations.length > 0);
  const auditNext = await call(history, "/api/documents/history", { source: "employee_upload", documentId: uploadItemRef.id, limit: "2", cursor: auditPage.body.continuations[0].cursor });
  assert.ok(auditNext.body.entries.some((entry) => entry.analysisMethod === "ocr"));

  await person.update({ unitIds: ["central-unit-b"] });
  assert.equal((await openEmployee("download")).status, 403);
  const revokedTimeline = await call(history, "/api/documents/history", { source: "employee_upload", documentId: uploadItemRef.id });
  assert.equal(JSON.stringify(revokedTimeline.body).includes("Nome-confirmado.pdf"), false);
  const revoked = await call(work, "/api/documents/work-items", { tab: "classify", source: "employee_upload", limit: "2" });
  assert.equal(revoked.body.items.length, 0);
  assert.equal((await call(history, "/api/documents/history", { source: "employee_upload" })).body.entries.length, 0);

  // Fluxos existem antes do arquivo e continuam após uma assinatura concluir.
  await profile.set({ permissions: { ...permissions, hr: { formalization: { view: true } }, dp: { ...permissions.dp, requests: { view: true } } } });
  await seed(hrDbAdmin, "onboardingProcesses", `${uid}-admission`, {
    status: "collecting_documents", candidateName: "Pessoa sintética", currentStage: "documents", createdAt: "2099-01-01T00:00:00.000Z",
    documents: [{ id: "registry", label: "Ficha de registro", required: true, status: "pending" }],
  });
  const flows = await call(work, "/api/documents/work-items", { tab: "flows", source: "onboarding" });
  assert.ok(flows.body.items.some((item) => item.missingFields.includes("Ficha de registro")));
  await seed(dbAdmin, "users", `${uid}-flow-person`, { unitIds: ["central-unit-a"] });
  await seed(hrDbAdmin, "terminationProcesses", `${uid}-termination`, { employeeId: `${uid}-flow-person`, employeeName: "Pessoa autorizada", status: "active", createdAt: "2026-11-02T00:00:00.000Z", terminationInternalReason: "Dado interno que não deve sair", steps: [{ id: "documents", label: "Contrato pendente", status: "pending" }] });
  const terminations = await call(work, "/api/documents/work-items", { tab: "flows", source: "termination" });
  assert.equal(terminations.body.items.length, 1, JSON.stringify(terminations.body));
  assert.equal(JSON.stringify(terminations.body).includes("Dado interno"), false);
  await hrDbAdmin.collection("terminationProcesses").doc(`${uid}-termination`).update({ steps: [{ id: "documents", label: "Documento dispensado", required: false, status: "waived" }] });
  const waivedProcess = await call(work, "/api/documents/work-items", { tab: "flows", source: "termination" });
  assert.deepEqual(waivedProcess.body.items[0].missingFields, []);
  await hrDbAdmin.collection("terminationProcesses").doc(`${uid}-termination`).update({ status: "completed" });
  assert.equal((await call(work, "/api/documents/work-items", { tab: "flows", source: "termination" })).body.items.length, 0);
  const completedProcess = await call(history, "/api/documents/history", { source: "termination" });
  assert.equal(completedProcess.body.entries[0].eventLabel, "Processo concluído");
  assert.equal(completedProcess.body.entries[0].recordKind, "current_snapshot");
  await seed(dbAdmin, "dp_vacations", `${uid}-vacation`, { userId: `${uid}-flow-person`, workflow: { status: "active", currentStage: "receipt_review", steps: [{ id: "receipt_review", label: "Recibo aguardando conferência", status: "pending" }] } });
  await profile.set({ permissions: { ...permissions, dp: { ...permissions.dp, vacation: { viewAll: true } } } });
  const vacations = await call(work, "/api/documents/work-items", { tab: "flows", source: "vacation" });
  assert.equal(vacations.body.items.length, 1, JSON.stringify(vacations.body));
  assert.deepEqual(vacations.body.items[0].missingFields, ["Recibo aguardando conferência"]);
  await dbAdmin.collection("users").doc(`${uid}-flow-person`).update({ unitIds: ["central-unit-b"] });
  assert.equal((await call(work, "/api/documents/work-items", { tab: "flows", source: "vacation" })).body.items.length, 0);
  await seed(dbAdmin, "companyDocuments", `${uid}-company`, { title: "Regularidade técnica", category: "Sistemas e conformidade", originalName: "original.pdf", standardizedName: "Regularidade.pdf", uploadedAt: "2099-01-01T00:00:00.000Z" });
  assert.equal((await call(history, "/api/documents/history", { source: "company" })).body.entries.length, 0);
  await profile.set({ permissions: { ...permissions, hr: { formalization: { view: true, companyDocuments: { view: true } } }, dp: { ...permissions.dp, requests: { view: true } } } });
  const company = await call(history, "/api/documents/history", { source: "company" });
  assert.equal(company.body.entries[0].recordKind, "current_snapshot");
  assert.equal(company.body.entries[0].originalName, "original.pdf");
  assert.equal(company.body.entries[0].appliedName, "Regularidade.pdf");
  // Duas confirmações repetidas são idempotentes; uma decisão obsoleta não sobrescreve a atual.
  const moveId = "00000000-0000-4000-8000-000000000007";
  const moveRef = await seed(dbAdmin, "companyDocuments", moveId, { category: "Sistemas e conformidade", title: "Evidência sintética", folderCode: null, evidenceSection: null, storagePath: "immutable/source.pdf", uploadedAt: "2099-01-01T00:00:00.000Z" });
  t.after(async () => {
    const events = await moveRef.collection("audit").get();
    await Promise.all(events.docs.map((doc) => doc.ref.delete()));
  });
  await profile.set({ permissions: { ...permissions, hr: { formalization: { view: true, companyDocuments: { manage: true } } }, dp: { ...permissions.dp, requests: { view: true } } } });
  const move = async (section, expected) => folder.POST(new NextRequest("http://localhost/api/documents/company/folder", { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: moveId, folderCode: "time_recording_compliance", evidenceSection: section, reason: "Organização técnica sintética", expected }) }), { params: Promise.resolve({}) });
  await moveRef.update({ workspaceId: "another-workspace" });
  assert.equal((await move("registration", { folderCode: null, evidenceSection: null })).status, 404);
  const foreignHistory = await call(history, "/api/documents/history", { source: "company", documentId: moveId });
  assert.equal(JSON.stringify(foreignHistory.body).includes("Evidência sintética"), false);
  const foreignList = await call(history, "/api/documents/history", { source: "company" });
  assert.equal(JSON.stringify(foreignList.body).includes("Evidência sintética"), false);
  await moveRef.update({ workspaceId: "coala" });
  const expected = { folderCode: null, evidenceSection: null };
  const moves = await Promise.all([move("registration", expected), move("registration", expected)]);
  assert.deepEqual(moves.map((result) => result.status), [200, 200]);
  assert.equal((await moveRef.collection("audit").get()).size, 1);
  assert.equal((await move("technical", expected)).status, 409);
  assert.equal((await moveRef.get()).get("storagePath"), "immutable/source.pdf");
  const trail = await call(history, "/api/documents/history", { source: "company", documentId: moveId });
  assert.equal(trail.body.entries.length, 1);
  assert.equal(trail.body.entries[0].eventLabel, "Documento movido");
  assert.match(trail.body.entries[0].detail, /Organização técnica sintética/);
  assert.equal(trail.body.entries[0].actorName, uid);
  await seed(dbAdmin, "dp_units", "central-unit-a", { name: "Unidade autorizada" });
  await seed(dbAdmin, "dp_units", "central-unit-b", { name: "Unidade restrita" });
  const options = await companyUnits.GET(new NextRequest("http://localhost/api/documents/company/units", { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({}) });
  assert.deepEqual((await options.json()).options.map((unit) => unit.id), ["central-unit-a"]);
  const uploadCompany = async (content, metadata) => {
    const form = new FormData();
    form.set("file", new File([content], "original.pdf", { type: "application/pdf" }));
    form.set("metadata", JSON.stringify(metadata));
    const response = await intake.POST(new NextRequest("http://localhost/api/documents/company/intake", { method: "POST", headers: { Authorization: `Bearer ${idToken}` }, body: form }), { params: Promise.resolve({}) });
    return { status: response.status, body: await response.json() };
  };
  const metadata = { title: "Cartão da unidade", category: "Fiscal e contábil", unitId: "central-unit-a", documentType: "CARTAO-CNPJ", reference: "" };
  const concurrent = await Promise.all([uploadCompany(binary, metadata), uploadCompany(binary, metadata)]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 201]);
  assert.equal(concurrent[0].body.document.id, concurrent[1].body.document.id);
  assert.equal(concurrent[0].body.document.standardizedName, "CARTAO-CNPJ__UNIDADE-central-unit-a__v01.pdf");
  const revision = await uploadCompany(Buffer.from("%PDF-1.4 new synthetic revision"), metadata);
  assert.equal(revision.body.document.version, 2);
  assert.equal((await uploadCompany(binary, metadata)).body.document.id, concurrent[0].body.document.id);
  assert.equal((await uploadCompany(binary, { ...metadata, unitId: "central-unit-b" })).status, 403);
  assert.equal((await uploadCompany(Buffer.from("not a PDF"), metadata)).status, 400);
  assert.equal((await uploadCompany(binary, { ...metadata, documentType: "ALVARA" })).status, 400);
  const unclassified = await uploadCompany(binary, { title: "Ainda não classificado", category: "Contratos" });
  assert.equal(unclassified.body.document.status, "pending_classification");
  const companyQueue = await call(work, "/api/documents/work-items", { tab: "classify", source: "company", limit: "50" });
  assert.ok(companyQueue.body.items.some((item) => item.documentRef.sourceId === unclassified.body.document.id));
  const classify = async (metadata) => intake.PATCH(new NextRequest("http://localhost/api/documents/company/intake", { method: "PATCH", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: unclassified.body.document.id, expectedVersion: 1, metadata }) }), { params: Promise.resolve({}) });
  const confirmedMetadata = { title: "Classificado depois", category: "Fiscal e contábil", documentType: "CERTIDAO", reference: "VENC-2027-01-01" };
  const beforeClassification = await dbAdmin.collection("companyDocuments").doc(unclassified.body.document.id).get();
  const confirmations = await Promise.all([classify(confirmedMetadata), classify(confirmedMetadata)]);
  assert.deepEqual(confirmations.map((response) => response.status), [200, 200]);
  const classified = await dbAdmin.collection("companyDocuments").doc(unclassified.body.document.id).get();
  assert.equal(classified.get("status"), "active");
  assert.equal(classified.get("standardizedName"), "CERTIDAO__GERAL__VENC-2027-01-01__v01.pdf");
  assert.equal(classified.get("storagePath"), beforeClassification.get("storagePath"));
  assert.equal(classified.get("originalName"), "original.pdf");
  assert.equal((await classify({ ...confirmedMetadata, reference: "OUTRO" })).status, 409);
  assert.equal((await classified.ref.collection("audit").where("action", "==", "DOCUMENT_CLASSIFIED").get()).size, 1);
  const classificationHistory = await call(history, "/api/documents/history", { source: "company", documentId: classified.id });
  assert.ok(classificationHistory.body.entries.some((entry) => entry.eventLabel === "Classificação confirmada" && entry.appliedName === classified.get("standardizedName")));
  assert.equal((await call(work, "/api/documents/work-items", { tab: "classify", source: "company", limit: "50" })).body.items.some((item) => item.documentRef.sourceId === classified.id), false);
  t.after(async () => {
    const uploaded = await dbAdmin.collection("companyDocuments").where("uploadedBy", "==", uid).get();
    for (const doc of uploaded.docs) {
      const events = await doc.ref.collection("audit").get();
      await Promise.all(events.docs.map((event) => event.ref.delete()));
      await getStorage(adminApp).bucket("demo-coala-repository.appspot.com").file(doc.get("storagePath")).delete({ ignoreNotFound: true });
      const contents = await dbAdmin.collection("companyDocumentContentKeys").where("documentId", "==", doc.id).get();
      await Promise.all(contents.docs.map((entry) => entry.ref.delete()));
      await dbAdmin.collection("companyDocumentLogicalKeys").doc(doc.get("logicalKey")).delete();
      await doc.ref.delete();
    }
  });
  await seed(hrDbAdmin, "dp_absenceCatalogMigrations", "active", { state: "ready", catalogDatabase: "coala-rh" });
  for (const unit of ["a", "b"]) await seed(hrDbAdmin, "dp_absenceRequests", `${uid}-absence-${unit}`, {
    id: `${uid}-absence-${unit}`, workspaceId: "coala", unitId: `central-unit-${unit}`, status: "in_review", startDate: "2099-01-01", updatedAt: "2099-01-01T00:00:00.000Z",
    beneficiaryUid: employeeId, requesterUid: employeeId, beneficiaryName: "Pessoa sintética", assignedReviewerIds: [],
    typeSnapshot: { name: "Ausência" }, policySnapshot: { approvalFlow: "dp" }, input: { startDate: "2099-01-01" }, attachments: [{ id: "proof", mime: "application/pdf", size: 12, storagePath: "private/secret.pdf" }], reason: "Dado clínico que não deve sair na central",
  });
  const absences = await call(work, "/api/documents/work-items", { tab: "flows", source: "absence" });
  assert.equal(absences.body.items.length, 1, JSON.stringify(absences.body));
  assert.match(absences.body.items[0].id, /absence-a$/);
  assert.equal(JSON.stringify(absences.body).includes("clínico"), false);
  assert.equal(JSON.stringify(absences.body).includes("secret.pdf"), false);

  for (let index = 0; index < 3; index++) await seed(financialDbAdmin, "financialInboxMessages", `${uid}-financial-${index}`, {
    workspaceId: "coala", status: "pending_review", receivedAt: `2099-01-0${3 - index}T00:00:00.000Z`, subject: "Nota sintética", attachments: [], classification: { documentType: "invoice" },
  });
  await seed(financialDbAdmin, "financialInboxMessages", `${uid}-financial-other`, {
    workspaceId: "another-workspace", status: "pending_review", receivedAt: "2099-02-01T00:00:00.000Z", subject: "Outra empresa", attachments: [], classification: { documentType: "invoice" },
  });

  await profile.set({ permissions: { financial: { view: true, inbox: { view: true, link: true } }, hr: { formalization: { view: false, documents: { view: false } } } } });
  const financial = await call(work, "/api/documents/work-items", { tab: "classify", source: "financial", limit: "2" });
  assert.equal(financial.status, 403, "permissão somente financeira não dá acesso à Central Documental");
  await seed(dbAdmin, "entities", `${uid}-supplier`, { name: "Contraparte sintética", isActive: true });
  const expenseRef = await seed(financialDbAdmin, "expenses", `${uid}-expense`, { workspaceId: "coala", supplierId: `${uid}-supplier`, supplier: "Contraparte sintética", amount: 100, status: "pending" });
  const namingMessage = await seed(financialDbAdmin, "financialInboxMessages", `${uid}-naming`, {
    workspaceId: "coala", linkedExpenseId: expenseRef.id, status: "linked", receivedAt: "2026-11-02T00:00:00.000Z", subject: "Recibo", classification: { documentType: "other" },
    attachments: [{ id: "document", filename: "nome-original.pdf", storagePath: file.name, sha256: createHash("sha256").update(binary).digest("hex"), contentType: "application/pdf" }],
  });
  t.after(async () => {
    const audit = await namingMessage.collection("audit").get();
    await Promise.all(audit.docs.map((event) => event.ref.delete()));
  });
  const namingPath = `/api/financial/inbox/${namingMessage.id}/files/document/naming`;
  const namingCall = async (body) => {
    const response = await financialNaming.POST(new NextRequest(`http://localhost${namingPath}`, { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: namingMessage.id, fileId: "document" }) });
    return { status: response.status, body: await response.json() };
  };
  const namingInput = { mode: "preview", documentType: "RECIBO-QUITACAO", reference: "2026-11" };
  const previewName = await namingCall(namingInput);
  assert.equal(previewName.status, 200, JSON.stringify(previewName.body));
  assert.match(previewName.body.naming.downloadName, /RECIBO-QUITACAO__CONTRAPARTE-central-integration-reader-supplier__2026-11__v01.pdf/);
  assert.equal((await namingMessage.get()).get("attachments")[0].documentNaming, undefined);
  const confirmName = { ...namingInput, mode: "confirm", expectedVersion: previewName.body.naming.version, expectedFingerprint: previewName.body.fingerprint };
  assert.equal((await namingCall(confirmName)).status, 200);
  assert.equal((await namingCall(confirmName)).status, 200);
  assert.equal((await namingMessage.collection("audit").where("action", "==", "DOCUMENT_NAMING_CONFIRMED").get()).size, 1);
  const financialTrail = await call(history, "/api/documents/history", { source: "financial", documentId: namingMessage.id });
  assert.equal(financialTrail.status, 200, "filtro legado permanece somente leitura para o perfil financeiro");
  assert.deepEqual(financialTrail.body.entries, [], "trilha da caixa permanece apenas na origem financeira");
  const namedAttachment = (await namingMessage.get()).get("attachments")[0];
  assert.equal(namedAttachment.filename, "nome-original.pdf");
  assert.equal(namedAttachment.storagePath, file.name);
  const delivered = await financialFile.GET(new NextRequest(`http://localhost/api/financial/inbox/${namingMessage.id}/files/document`, { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({ id: namingMessage.id, fileId: "document" }) });
  assert.equal(delivered.status, 200);
  assert.match(delivered.headers.get("Content-Disposition"), /RECIBO-QUITACAO/);
  assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), binary);
  await expenseRef.update({ supplierId: "another-entity" });
  await seed(dbAdmin, "entities", "another-entity", { name: "Outra contraparte" });
  assert.equal((await namingCall(confirmName)).status, 409);
  await expenseRef.update({ supplierId: "" });
  assert.equal((await namingCall(namingInput)).status, 409);
  const manualScopeInput = { ...namingInput, counterpartyId: `${uid}-supplier` };
  assert.equal((await namingCall(manualScopeInput)).status, 403);
  await profile.set({ permissions: { financial: { view: true, inbox: { view: true, link: true } }, registration: { view: true }, hr: { formalization: { view: false } } } });
  const choicesResponse = await counterparties.GET(new NextRequest("http://localhost/api/financial/document-counterparties", { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({}) });
  assert.equal(choicesResponse.status, 200);
  const choices = await choicesResponse.json();
  assert.ok(choices.options.some((entry) => entry.id === `${uid}-supplier`));
  assert.ok(choices.options.every((entry) => Object.keys(entry).sort().join(",") === "id,name"));
  const manualScope = await namingCall(manualScopeInput);
  assert.equal(manualScope.status, 200, JSON.stringify(manualScope.body));
  assert.equal((await namingCall({ ...manualScopeInput, mode: "confirm", expectedVersion: manualScope.body.naming.version, expectedFingerprint: manualScope.body.fingerprint })).status, 200);
  assert.equal((await expenseRef.get()).get("supplierId"), "");
  assert.equal((await namingMessage.get()).get("attachments")[0].documentNaming.scopeSource, "document_confirmation");
  // A confirmação por IDs projeta a mesma NF em dois ativos sem duplicar bytes.
  const invoiceBytes = Buffer.from("%PDF-NF-patrimonial-sintetica");
  const invoiceHash = createHash("sha256").update(invoiceBytes).digest("hex");
  const invoiceMessageId = `${uid}-invoice`, invoiceFileId = "nf1";
  const invoiceStoragePath = `financial-inbox/coala/${invoiceMessageId}/attachments/${invoiceFileId}-nf.pdf`;
  const invoiceBlob = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).file(invoiceStoragePath);
  await invoiceBlob.save(invoiceBytes, { resumable: false, metadata: { contentType: "application/pdf", metadata: { sha256: invoiceHash } } });
  t.after(() => invoiceBlob.delete({ ignoreNotFound: true }));
  const firstAsset = await seed(dbAdmin, "assets", `${uid}-asset-a`, { workspaceId: "coala", code: "PAT-990001", name: "Ativo A" });
  const secondAsset = await seed(dbAdmin, "assets", `${uid}-asset-b`, { workspaceId: "coala", code: "PAT-990002", name: "Ativo B" });
  const invoiceMessage = await seed(financialDbAdmin, "financialInboxMessages", invoiceMessageId, { workspaceId: "coala", provider: "resend", status: "pending_review", classification: { barcode: null }, attachments: [{ id: invoiceFileId, filename: "nf.pdf", contentType: "application/pdf", storagePath: invoiceStoragePath, sha256: invoiceHash, archiveStatus: "stored" }] });
  t.after(async () => { const events = await invoiceMessage.collection("audit").get(); await Promise.all(events.docs.map((event) => event.ref.delete())); });
  await profile.set({ permissions: { financial: { view: true, inbox: { view: true, link: true, discard: true } }, assets: { view: true, edit: true } } });
  const destinationPath = `/api/financial/inbox/${invoiceMessageId}/files/${invoiceFileId}/destination`;
  const destinationCall = (body) => invoiceDestination.POST(new NextRequest(`http://localhost${destinationPath}`, { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: invoiceMessageId, fileId: invoiceFileId }) });
  const assetDecision = { kind: "asset_invoice", assetIds: [firstAsset.id, secondAsset.id], expectedSha256: invoiceHash };
  assert.equal((await destinationCall(assetDecision)).status, 200);
  await firstAsset.update({ inboxInvoiceRefs: [], inboxInvoiceKeys: [] }); // falha parcial simulada após intenção na origem
  assert.equal((await destinationCall(assetDecision)).status, 200); // retry repara só a projeção
  assert.equal((await firstAsset.get()).get("inboxInvoiceRefs").length, 1);
  assert.equal((await secondAsset.get()).get("inboxInvoiceRefs").length, 1);
  assert.equal((await destinationCall({ ...assetDecision, assetIds: [firstAsset.id] })).status, 409);
  const lookup = await assetLookup.GET(new NextRequest("http://localhost/api/assets/lookup?code=PAT-990002", { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({}) });
  assert.deepEqual((await lookup.json()).map((asset) => asset.id), [secondAsset.id]);
  await profile.set({ permissions: { assets: { view: true } } });
  const invoiceRead = await assetInvoice.GET(new NextRequest(`http://localhost/api/assets/${firstAsset.id}/inbox-invoices/${invoiceMessageId}/${invoiceFileId}`, { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({ assetId: firstAsset.id, messageId: invoiceMessageId, fileId: invoiceFileId }) });
  assert.equal(invoiceRead.status, 200);
  assert.deepEqual(Buffer.from(await invoiceRead.arrayBuffer()), invoiceBytes);
  await firstAsset.update({ workspaceId: "another-workspace" });
  assert.equal((await assetInvoice.GET(new NextRequest(`http://localhost/api/assets/${firstAsset.id}/inbox-invoices/${invoiceMessageId}/${invoiceFileId}`, { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({ assetId: firstAsset.id, messageId: invoiceMessageId, fileId: invoiceFileId }) })).status, 404);
  const nonAssetMessage = await seed(financialDbAdmin, "financialInboxMessages", `${uid}-nonasset`, { workspaceId: "coala", provider: "resend", attachments: [{ id: "nf", filename: "nf.pdf", contentType: "application/pdf", storagePath: `financial-inbox/coala/${uid}-nonasset/attachments/nf.pdf`, sha256: invoiceHash, destination: { kind: "non_asset_invoice", assetIds: [], version: 1, sha256: invoiceHash, confirmedAt: "2026-11-03", confirmedBy: uid, deletionState: "pending" } }] });
  await profile.set({ permissions: { financial: { view: true, inbox: { view: true, discard: true } } } });
  const deniedDelete = await invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${nonAssetMessage.id}/files/nf/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: invoiceHash, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: nonAssetMessage.id, fileId: "nf" }) });
  assert.equal(deniedDelete.status, 403, "descartar cobrança não concede exclusão física");
  // Duas NFs do mesmo EML disputam o lock da mensagem; retry preserva só o boleto.
  const MailComposer = (await import("nodemailer/lib/mail-composer/index.js")).default;
  const mailParts = [Buffer.from("%PDF-NF-1"), Buffer.from("%PDF-NF-2"), Buffer.from("%PDF-BOLETO")];
  const mail = new MailComposer({ from: "supplier@example.com", to: "financeiro@example.com", subject: "Três anexos", text: "Cobrança sintética", attachments: mailParts.map((content, index) => ({ filename: `${index < 2 ? "nf" : "boleto"}-${index}.pdf`, content, contentType: "application/pdf" })) });
  const emlBytes = await new Promise((resolve, reject) => mail.compile().build((error, value) => error ? reject(error) : resolve(value)));
  const emlId = `${uid}-mixed`, emlBase = `financial-inbox/coala/${emlId}`;
  const emlBucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const originalRaw = `${emlBase}/original.eml`;
  await emlBucket.file(originalRaw).save(emlBytes, { resumable: false, metadata: { contentType: "message/rfc822", metadata: { sha256: createHash("sha256").update(emlBytes).digest("hex") } } });
  const emlAttachments = await Promise.all(mailParts.map(async (bytes, index) => {
    const path = `${emlBase}/attachments/file${index}.pdf`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await emlBucket.file(path).save(bytes, { resumable: false, metadata: { contentType: "application/pdf", metadata: { sha256 } } });
    return { id: `file${index}`, filename: `${index < 2 ? "nf" : "boleto"}-${index}.pdf`, contentType: "application/pdf", storagePath: path, sha256, archiveStatus: "stored" };
  }));
  const sidecarPath = `${emlAttachments[0].storagePath}.extracted-v1.txt`;
  await emlBucket.file(sidecarPath).save(Buffer.from("Texto fiscal sensível"), { resumable: false });
  const sidecarV2 = `${emlAttachments[0].storagePath}.extracted-v2.txt`;
  const boletoSidecar = `${emlAttachments[2].storagePath}.extracted-v1.txt`;
  await emlBucket.file(sidecarV2).save(Buffer.from("Outra versão de texto fiscal"), { resumable: false, metadata: { metadata: { sourceSha256: emlAttachments[0].sha256 } } });
  await emlBucket.file(boletoSidecar).save(Buffer.from("Texto do boleto preservado"), { resumable: false, metadata: { metadata: { sourceSha256: emlAttachments[2].sha256 } } });
  emlAttachments[0].extractedTextStoragePath = sidecarPath;
  emlAttachments[0].extractedHints = { documentText: "Texto fiscal sensível", barcode: null };
  const mixed = await seed(financialDbAdmin, "financialInboxMessages", emlId, { workspaceId: "coala", provider: "resend", status: "pending_review", updatedAt: "2026-11-03T00:00:00.000Z", classification: { barcode: null }, rawStoragePath: originalRaw, rawSha256: createHash("sha256").update(emlBytes).digest("hex"), attachments: emlAttachments });
  t.after(async () => { const audits = await mixed.collection("audit").get(); await Promise.all(audits.docs.map((entry) => entry.ref.delete())); const [stored] = await emlBucket.getFiles({ prefix: `${emlBase}/`, autoPaginate: false, maxResults: 30 }); await Promise.all(stored.map((item) => item.delete({ ignoreNotFound: true }))); });
  await profile.set({ permissions: { financial: { view: true, inbox: { view: true, discard: true, deleteFiles: true } } } });
  const classifyInvoice = async (index) => invoiceDestination.POST(new NextRequest(`http://localhost/api/financial/inbox/${emlId}/files/file${index}/destination`, { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "non_asset_invoice", assetIds: [], expectedSha256: emlAttachments[index].sha256 }) }), { params: Promise.resolve({ id: emlId, fileId: `file${index}` }) });
  assert.equal((await classifyInvoice(0)).status, 200);
  assert.equal((await classifyInvoice(1)).status, 200);
  const bucketPrototype = Object.getPrototypeOf(emlBucket), originalMetadata = bucketPrototype.getMetadata;
  const originalGetFiles = bucketPrototype.getFiles;
  // Storage Emulator não implementa política do bucket; injeta apenas esse metadado do demo.
  bucketPrototype.getMetadata = async function () { return [{ softDeletePolicy: { retentionDurationSeconds: 7 * 86400 } }]; };
  bucketPrototype.getFiles = async function (options) { return originalGetFiles.call(this, options?.prefix === `${emlAttachments[0].storagePath}.extracted-` ? { ...options, maxResults: 1 } : options); };
  t.after(() => { bucketPrototype.getMetadata = originalMetadata; bucketPrototype.getFiles = originalGetFiles; });
  const dispose = async (index) => invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${emlId}/files/file${index}/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: emlAttachments[index].sha256, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: emlId, fileId: `file${index}` }) });
  const concurrentDisposal = await Promise.all([dispose(0), dispose(1)]);
  assert.ok(concurrentDisposal.some((response) => response.status === 200), JSON.stringify(await Promise.all(concurrentDisposal.map(async (response) => ({ status: response.status, body: await response.clone().json() })))));
  const retry = await Promise.all([dispose(0), dispose(1)]);
  assert.ok(retry.every((response) => response.status === 200), JSON.stringify(await Promise.all(retry.map(async (response) => ({ status: response.status, body: await response.clone().json() })))));
  const finalMixed = await mixed.get();
  assert.equal(finalMixed.get("rawArchiveOperation"), null);
  assert.equal(finalMixed.get("rawArchiveState"), "redacted");
  assert.equal(finalMixed.get("attachments")[0].extractedHints, null);
  assert.equal((await emlBucket.file(sidecarPath).exists())[0], false);
  assert.equal((await emlBucket.file(sidecarV2).exists())[0], false);
  assert.equal((await emlBucket.file(boletoSidecar).exists())[0], true);
  const finalRaw = (await emlBucket.file(finalMixed.get("rawStoragePath")).download())[0];
  const parsedRaw = await (await import("mailparser")).simpleParser(finalRaw);
  assert.deepEqual(parsedRaw.attachments.map((item) => createHash("sha256").update(item.content).digest("hex")), [emlAttachments[2].sha256]);
  assert.deepEqual((await emlBucket.file(emlAttachments[2].storagePath).download())[0], mailParts[2]);
  assert.equal((await ingestFinancialEmail({ eventId: `late-${emlId}`, eventAt: "2026-11-03T00:00:00.000Z", emailId: emlId, apiKey: "synthetic", received: { raw: { download_url: "https://resend.com/blocked-by-existing" } } })).duplicate, true);
  assert.equal((await emlBucket.file(originalRaw).exists())[0], false, "callback atrasado não recria EML original após descarte");
  // A crash after the durable claim but before candidate upload leaves no orphan; retry rebuilds it.
  const crashId = `${uid}-claim-crash`, crashBase = `financial-inbox/coala/${crashId}`;
  const crashRaw = `${crashBase}/original.eml`, crashTarget = `${crashBase}/attachments/nf.pdf`;
  await emlBucket.file(crashRaw).save(emlBytes, { resumable: false, metadata: { metadata: { sha256: createHash("sha256").update(emlBytes).digest("hex") } } });
  await emlBucket.file(crashTarget).save(mailParts[0], { resumable: false, metadata: { metadata: { sha256: emlAttachments[0].sha256 } } });
  const crashMessage = await seed(financialDbAdmin, "financialInboxMessages", crashId, { workspaceId: "coala", provider: "resend", rawStoragePath: crashRaw, rawSha256: createHash("sha256").update(emlBytes).digest("hex"), attachments: [{ id: "nf", filename: "nf.pdf", contentType: "application/pdf", storagePath: crashTarget, sha256: emlAttachments[0].sha256, destination: { kind: "non_asset_invoice", assetIds: [], version: 1, sha256: emlAttachments[0].sha256, confirmedAt: "2026-11-03", confirmedBy: uid, deletionState: "pending" } }] });
  t.after(async () => { const audits = await crashMessage.collection("audit").get(); await Promise.all(audits.docs.map((entry) => entry.ref.delete())); const [stored] = await emlBucket.getFiles({ prefix: `${crashBase}/`, autoPaginate: false, maxResults: 20 }); await Promise.all(stored.map((item) => item.delete({ ignoreNotFound: true }))); });
  const crashDispose = () => invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${crashId}/files/nf/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: emlAttachments[0].sha256, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: crashId, fileId: "nf" }) });
  const savePrototype = Object.getPrototypeOf(emlBucket.file(crashRaw)), originalSave = savePrototype.save;
  let saveFailure = false;
  savePrototype.save = async function (...args) { if (this.name.startsWith(`${crashBase}/redacted/`) && !saveFailure) { saveFailure = true; throw new Error("synthetic failure after durable claim"); } return originalSave.apply(this, args); };
  try { assert.equal((await crashDispose()).status, 500); } finally { savePrototype.save = originalSave; }
  assert.equal(saveFailure, true);
  const crashPending = await crashMessage.get();
  assert.equal(crashPending.get("rawArchiveState"), "redacting");
  assert.equal((await emlBucket.file(crashPending.get("rawArchiveOperation").nextRawPath).exists())[0], false);
  assert.equal((await crashDispose()).status, 200);
  const crashFinal = await crashMessage.get();
  assert.equal(crashFinal.get("rawArchiveState"), "redacted");
  assert.deepEqual((await (await import("mailparser")).simpleParser((await emlBucket.file(crashFinal.get("rawStoragePath")).download())[0])).attachments.map((item) => createHash("sha256").update(item.content).digest("hex")), [emlAttachments[1].sha256, emlAttachments[2].sha256]);
  // Two DELETEs for one file must not let the losing claim remove the winner's sanitized EML.
  const sameId = `${uid}-same-file`, sameBase = `financial-inbox/coala/${sameId}`;
  const sameRawPath = `${sameBase}/original.eml`, sameTargetPath = `${sameBase}/attachments/nf.pdf`, sameBoletoPath = `${sameBase}/attachments/boleto.pdf`;
  await emlBucket.file(sameRawPath).save(emlBytes, { resumable: false, metadata: { metadata: { sha256: createHash("sha256").update(emlBytes).digest("hex") } } });
  await emlBucket.file(sameTargetPath).save(mailParts[0], { resumable: false, metadata: { metadata: { sha256: emlAttachments[0].sha256 } } });
  await emlBucket.file(sameBoletoPath).save(mailParts[2], { resumable: false, metadata: { metadata: { sha256: emlAttachments[2].sha256 } } });
  const sameMessage = await seed(financialDbAdmin, "financialInboxMessages", sameId, { workspaceId: "coala", provider: "resend", status: "pending_review", rawStoragePath: sameRawPath, rawSha256: createHash("sha256").update(emlBytes).digest("hex"), attachments: [{ id: "nf", filename: "nf.pdf", contentType: "application/pdf", storagePath: sameTargetPath, sha256: emlAttachments[0].sha256, destination: { kind: "non_asset_invoice", assetIds: [], version: 1, sha256: emlAttachments[0].sha256, confirmedAt: "2026-11-03", confirmedBy: uid, deletionState: "pending" } }, { id: "boleto", filename: "boleto.pdf", contentType: "application/pdf", storagePath: sameBoletoPath, sha256: emlAttachments[2].sha256 }] });
  t.after(async () => { const audits = await sameMessage.collection("audit").get(); await Promise.all(audits.docs.map((entry) => entry.ref.delete())); const [stored] = await emlBucket.getFiles({ prefix: `${sameBase}/`, autoPaginate: false, maxResults: 20 }); await Promise.all(stored.map((item) => item.delete({ ignoreNotFound: true }))); });
  const filePrototype = Object.getPrototypeOf(emlBucket.file(sameTargetPath)), originalDelete = filePrototype.delete;
  let injectedFailure = false;
  filePrototype.delete = async function (options) { if (this.name === sameTargetPath && !injectedFailure) { injectedFailure = true; throw new Error("synthetic failure after original EML deletion"); } return originalDelete.call(this, options); };
  const disposeSame = () => invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${sameId}/files/nf/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: emlAttachments[0].sha256, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: sameId, fileId: "nf" }) });
  try { await Promise.all([disposeSame(), disposeSame()]); } finally { filePrototype.delete = originalDelete; }
  assert.equal(injectedFailure, true);
  const samePending = await sameMessage.get();
  assert.equal(samePending.get("rawArchiveState"), "redacting");
  assert.equal((await emlBucket.file(samePending.get("rawArchiveOperation").nextRawPath).exists())[0], true);
  assert.equal((await disposeSame()).status, 200);
  const sameFinal = await sameMessage.get();
  assert.equal(sameFinal.get("rawArchiveState"), "redacted");
  assert.deepEqual((await (await import("mailparser")).simpleParser((await emlBucket.file(sameFinal.get("rawStoragePath")).download())[0])).attachments.map((item) => createHash("sha256").update(item.content).digest("hex")), [emlAttachments[1].sha256, emlAttachments[2].sha256]);
  assert.deepEqual((await emlBucket.file(sameBoletoPath).download())[0], mailParts[2]);
  const duplicateId = `${uid}-duplicate-mime`, duplicateBase = `financial-inbox/coala/${duplicateId}`;
  const duplicateRawPath = `${duplicateBase}/original.eml`, duplicateTarget = `${duplicateBase}/attachments/nf.pdf`;
  const duplicateMail = new MailComposer({ from: "supplier@example.com", to: "financeiro@example.com", subject: "Partes iguais", text: "Teste", attachments: [{ filename: "nf.pdf", content: mailParts[0], contentType: "application/pdf" }, { filename: "inline-duplicado.pdf", content: mailParts[0], contentType: "application/pdf", contentDisposition: "inline" }] });
  const duplicateRaw = await new Promise((resolve, reject) => duplicateMail.compile().build((error, value) => error ? reject(error) : resolve(value)));
  await emlBucket.file(duplicateRawPath).save(duplicateRaw, { resumable: false, metadata: { metadata: { sha256: createHash("sha256").update(duplicateRaw).digest("hex") } } });
  await emlBucket.file(duplicateTarget).save(mailParts[0], { resumable: false, metadata: { metadata: { sha256: emlAttachments[0].sha256 } } });
  const duplicateMessage = await seed(financialDbAdmin, "financialInboxMessages", duplicateId, { workspaceId: "coala", provider: "resend", rawStoragePath: duplicateRawPath, rawSha256: createHash("sha256").update(duplicateRaw).digest("hex"), attachments: [{ id: "nf", filename: "nf.pdf", contentType: "application/pdf", storagePath: duplicateTarget, sha256: emlAttachments[0].sha256, destination: { kind: "non_asset_invoice", assetIds: [], version: 1, sha256: emlAttachments[0].sha256, confirmedAt: "2026-11-03", confirmedBy: uid, deletionState: "pending" } }] });
  t.after(async () => { const [objects] = await emlBucket.getFiles({ prefix: `${duplicateBase}/`, autoPaginate: false, maxResults: 10 }); await Promise.all(objects.map((object) => object.delete({ ignoreNotFound: true }))); });
  const duplicateDelete = await invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${duplicateId}/files/nf/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: emlAttachments[0].sha256, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: duplicateId, fileId: "nf" }) });
  assert.equal(duplicateDelete.status, 409);
  assert.match((await duplicateDelete.json()).error.message, /partes idênticas/);
  assert.equal((await duplicateMessage.get()).get("rawArchiveOperation"), undefined, "duplicata MIME bloqueia antes do claim");
  assert.equal((await emlBucket.file(duplicateTarget).exists())[0], true);
  // Analysis owns a durable message claim before writing text; deletion waits, then removes every version.
  const fenceId = `${uid}-analysis-fence`, fenceBase = `financial-inbox/coala/${fenceId}`;
  const xmlBytes = Buffer.from("<NFe><info>Nota fiscal de teste com texto extraível</info></NFe>");
  const xmlHash = createHash("sha256").update(xmlBytes).digest("hex");
  const fenceRaw = `${fenceBase}/original.eml`, fenceTarget = `${fenceBase}/attachments/nf.xml`, fenceOther = `${fenceBase}/attachments/outro.pdf`;
  const fenceMail = new MailComposer({ from: "supplier@example.com", to: "financeiro@example.com", subject: "Documento recebido", text: "Mensagem sintética", attachments: [{ filename: "nf.xml", content: xmlBytes, contentType: "application/xml" }, { filename: "outro.pdf", content: mailParts[2], contentType: "application/pdf" }] });
  const fenceRawBytes = await new Promise((resolve, reject) => fenceMail.compile().build((error, value) => error ? reject(error) : resolve(value)));
  await emlBucket.file(fenceRaw).save(fenceRawBytes, { resumable: false, metadata: { metadata: { sha256: createHash("sha256").update(fenceRawBytes).digest("hex") } } });
  await emlBucket.file(fenceTarget).save(xmlBytes, { resumable: false, metadata: { metadata: { sha256: xmlHash } } });
  await emlBucket.file(fenceOther).save(mailParts[2], { resumable: false, metadata: { metadata: { sha256: emlAttachments[2].sha256 } } });
  const oldFenceSidecar = `${fenceTarget}.extracted-pdfjs-v1.txt`, otherFenceSidecar = `${fenceOther}.extracted-pdfjs-v1.txt`;
  await emlBucket.file(oldFenceSidecar).save(Buffer.from("Versão antiga da NF"), { resumable: false });
  await emlBucket.file(otherFenceSidecar).save(Buffer.from("Texto de outro arquivo"), { resumable: false });
  const fenceMessage = await seed(financialDbAdmin, "financialInboxMessages", fenceId, { workspaceId: "coala", provider: "resend", status: "pending_review", updatedAt: "2026-11-03T00:00:00.000Z", receivedAt: "2026-11-03T00:00:00.000Z", from: "supplier@example.com", senderDomain: "example.com", subject: "Documento recebido", textContent: "Mensagem sintética", classification: classifyFinancialEmail({ subject: "Documento recebido", text: "Mensagem sintética", senderDomain: "example.com" }).classification, rawStoragePath: fenceRaw, rawSha256: createHash("sha256").update(fenceRawBytes).digest("hex"), attachments: [{ id: "nf", filename: "nf.xml", contentType: "application/xml", storagePath: fenceTarget, sha256: xmlHash, archiveStatus: "stored" }, { id: "other", filename: "outro.pdf", contentType: "application/pdf", storagePath: fenceOther, sha256: emlAttachments[2].sha256, archiveStatus: "stored" }] });
  t.after(async () => { const audits = await fenceMessage.collection("audit").get(); const events = await fenceMessage.collection("events").get(); await Promise.all([...audits.docs, ...events.docs].map((entry) => entry.ref.delete())); const [objects] = await emlBucket.getFiles({ prefix: `${fenceBase}/`, autoPaginate: false, maxResults: 30 }); await Promise.all(objects.map((object) => object.delete({ ignoreNotFound: true }))); });
  const fenceSavePrototype = Object.getPrototypeOf(emlBucket.file(fenceTarget)), saveOriginal = fenceSavePrototype.save;
  let releaseSidecar, enterSidecar;
  const sidecarEntered = new Promise((resolve) => { enterSidecar = resolve; });
  const sidecarGate = new Promise((resolve) => { releaseSidecar = resolve; });
  fenceSavePrototype.save = async function (...args) { if (this.name.startsWith(`${fenceTarget}.extracted-`)) { enterSidecar(); await sidecarGate; } return saveOriginal.apply(this, args); };
  const analysis = analyzeFinancialInboxMessage(fenceId, "coala");
  try {
    await sidecarEntered;
    assert.ok((await fenceMessage.get()).get("documentAnalysisOperation"));
    const fencePost = invoiceDestination.POST(new NextRequest(`http://localhost/api/financial/inbox/${fenceId}/files/nf/destination`, { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "non_asset_invoice", assetIds: [], expectedSha256: xmlHash }) }), { params: Promise.resolve({ id: fenceId, fileId: "nf" }) });
    assert.equal((await fencePost).status, 200);
    const blocked = await invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${fenceId}/files/nf/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: xmlHash, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: fenceId, fileId: "nf" }) });
    assert.equal(blocked.status, 409, "descarte não passa pelo claim de análise enquanto o sidecar pode ser salvo");
  } finally { releaseSidecar(); fenceSavePrototype.save = saveOriginal; }
  await analysis;
  assert.equal((await fenceMessage.get()).get("documentAnalysisOperation"), null);
  const lateSidecars = (await emlBucket.getFiles({ prefix: `${fenceTarget}.extracted-`, autoPaginate: false, maxResults: 20 }))[0];
  assert.ok(lateSidecars.length >= 2, "versões antiga e nova coexistem antes do descarte");
  const fenceDelete = await invoiceDestination.DELETE(new NextRequest(`http://localhost/api/financial/inbox/${fenceId}/files/nf/destination`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expectedSha256: xmlHash, expectedVersion: 1, confirmed: true }) }), { params: Promise.resolve({ id: fenceId, fileId: "nf" }) });
  assert.equal(fenceDelete.status, 200);
  assert.equal((await emlBucket.getFiles({ prefix: `${fenceTarget}.extracted-`, autoPaginate: false, maxResults: 20 }))[0].length, 0);
  assert.equal((await emlBucket.file(otherFenceSidecar).exists())[0], true);
  assert.equal((await emlBucket.file(fenceTarget).exists())[0], false);
  const financeOnly = await call(work, "/api/documents/work-items", { tab: "signatures", source: "generated" });
  assert.equal(financeOnly.status, 403);
  assert.equal((await call(generated, "/api/documents/generated", { documentId: `${uid}-old-discarded` })).status, 403);
  assert.equal((await call(history, "/api/documents/history", { source: "employee_upload" })).status, 403);
  await profile.set({ permissions: { hr: { formalization: { view: false } } } });
  assert.equal((await call(work, "/api/documents/work-items", { tab: "classify" })).status, 403);
  assert.equal((await call(history, "/api/documents/history", { source: "employee_upload" })).status, 403);

  // Exercita o cliente real do provedor com transporte substituído, sem envio externo.
  const originalFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(["AUTENTIQUE_API_TOKEN", "AUTENTIQUE_SANDBOX", "AUTENTIQUE_ALLOW_PRODUCTION", "AUTENTIQUE_WEBHOOK_SECRET"].map((key) => [key, process.env[key]]));
  const providerId = "00000000-0000-4000-8000-000000000099";
  const webhookSecret = "synthetic-webhook-secret-only";
  try {
    process.env.AUTENTIQUE_API_TOKEN = "synthetic-token-only";
    process.env.AUTENTIQUE_SANDBOX = "true";
    process.env.AUTENTIQUE_ALLOW_PRODUCTION = "false";
    process.env.AUTENTIQUE_WEBHOOK_SECRET = webhookSecret;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.autentique.com.br/v2/graphql");
      if (init.body instanceof FormData) {
        const operations = JSON.parse(String(init.body.get("operations")));
        assert.match(operations.query, /sandbox: true/);
        assert.deepEqual(Buffer.from(await init.body.get("file").arrayBuffer()), binary);
        assert.equal(operations.variables.signers[0].email, "signer@example.test");
        return Response.json({ data: { createDocument: { id: providerId, name: "Documento sintético", signatures: [] } } });
      }
      return Response.json({ data: { document: { id: providerId, signatures_count: 1, signed_count: 1, files: { signed: "https://example.test/signed.pdf" } } } });
    };
    const created = await autentique.createAutentiqueDocument({ buffer: binary, fileName: "sintetico.pdf", documentName: "Documento sintético", signers: [{ email: "signer@example.test" }] });
    assert.equal(created.sandbox, true);
    assert.equal((await autentique.getAutentiqueDocumentStatus(providerId)).completed, true);
    globalThis.fetch = originalFetch;
    const request = await seed(hrDbAdmin, "hrSignatureRequests", `${uid}-signature`, { providerDocumentId: providerId, status: "sent", participants: {} });
    const eventId = `${uid}-webhook-viewed`;
    refs.push(hrDbAdmin.collection("hrAutentiqueWebhookEvents").doc(eventId));
    const body = JSON.stringify({ event: { id: eventId, type: "signature.viewed", created_at: "2026-11-02T00:00:00.000Z", data: { object: { public_id: "signer-1", document: providerId } } } });
    const webhookCall = (signature) => autentiqueWebhook.POST(new NextRequest("http://localhost/api/webhooks/autentique", { method: "POST", headers: { "Content-Type": "application/json", "x-autentique-signature": signature }, body }), { params: Promise.resolve({}) });
    assert.equal((await webhookCall("invalid")).status, 401);
    const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
    assert.equal((await webhookCall(signature)).status, 200);
    const duplicate = await webhookCall(signature);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal((await request.get()).get("status"), "viewed");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
