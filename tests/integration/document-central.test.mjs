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
const work = await import("../../src/app/api/documents/work-items/route.ts");
const history = await import("../../src/app/api/documents/history/route.ts");
const generated = await import("../../src/app/api/documents/generated/route.ts");
const folder = await import("../../src/app/api/documents/company/folder/route.ts");
const employeeAccess = await import("../../src/app/api/hr/employee-documents/access/route.ts");
const intake = await import("../../src/app/api/documents/company/intake/route.ts");
const companyUnits = await import("../../src/app/api/documents/company/units/route.ts");
const financialNaming = await import("../../src/app/api/financial/inbox/[id]/files/[fileId]/naming/route.ts");
const financialFile = await import("../../src/app/api/financial/inbox/[id]/files/[fileId]/route.ts");
const counterparties = await import("../../src/app/api/financial/document-counterparties/route.ts");
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
    const permanentPath = `hr/employee-documents/${person}/documents/${archiveId}/versions/01/signed.pdf`;
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
    assert.equal(archived.get("employeeId"), person);
    assert.equal((await hrDbAdmin.collection("employeeDocuments").where("sourceOnboardingId", "==", onboardingId).limit(10).get()).size, 1);
    for (const ref of workflowRefs) assert.equal((await ref.get()).get("employeeDocumentId"), archiveId);
    assert.equal((await requestRef.get()).get("archivedDocumentId"), archiveId);
    assert.equal(createHash("sha256").update((await bucket.file(permanentPath).download())[0]).digest("hex"), contentHash);
    assert.equal((await archiveRef.collection("audit").where("action", "==", "SIGNED_DOCUMENT_ARCHIVED").get()).size, 1);
  }
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
  assert.equal(financial.body.items.length, 2, JSON.stringify(financial.body));
  assert.ok(financial.body.items.every((item) => item.title === "Nota sintética"));
  const financialNext = await call(work, "/api/documents/work-items", { tab: "classify", source: "financial", stage: "classify", limit: "2", cursor: financial.body.continuations[0].cursor });
  assert.equal(financialNext.body.items.length, 1);
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
  assert.ok(financialTrail.body.entries.some((entry) => entry.eventLabel === "Nome confirmado" && entry.appliedName === previewName.body.naming.downloadName));
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
  const financeOnly = await call(work, "/api/documents/work-items", { tab: "signatures", source: "generated" });
  assert.equal(financeOnly.status, 200);
  assert.deepEqual(financeOnly.body.items, []);
  assert.equal((await call(generated, "/api/documents/generated", { documentId: `${uid}-old-discarded` })).status, 403);
  assert.equal((await call(history, "/api/documents/history", { source: "employee_upload" })).body.entries.length, 0);
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
