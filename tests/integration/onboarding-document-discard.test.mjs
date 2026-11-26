import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
import { enableServerOnlyTestImports } from "../helpers/server-only-runtime.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
enableServerOnlyTestImports("demo-coala-repository");
const { adminApp, dbAdmin, authAdmin } = await import("../../src/lib/firebase-admin.ts");
const { hrDbAdmin } = await import("../../src/lib/firebase-rh-admin.ts");
const { discardCancelledOnboardingDocuments } = await import("../../src/lib/hr/onboarding-document-discard.server.ts");
const job = await import("../../src/app/api/jobs/hr/onboarding-document-discard/route.ts");
const { projectDocumentReceiptPaid } = await import("../../src/features/financial/payment-requests/document-receipt-projection.server.ts");
const { submitOpenOnboardingProcess } = await import("../../src/lib/hr/onboarding-process-write.server.ts");

test("admissão: descarte físico, retomada justa e eventos tardios mantêm o encerramento", async (t) => {
  const refs = [], objects = [], bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const previousSecret = process.env.ONBOARDING_DOCUMENT_DISCARD_SECRET;
  process.env.ONBOARDING_DOCUMENT_DISCARD_SECRET = "synthetic-discard-secret-only";
  const seed = async (db, collection, id, data) => { const ref = db.collection(collection).doc(id); refs.push(ref); await ref.set(data); return ref; };
  const put = async (name, metadata = {}) => { objects.push(name); await bucket.file(name).save(Buffer.from("synthetic-private-document"), { resumable: false, metadata: { metadata } }); return name; };
  const parent = (id, extra = {}) => seed(hrDbAdmin, "onboardingProcesses", id, { status: "cancelled", workspaceId: "coala", unitId: "discard-unit-a", documentDiscard: { status: "pending" }, ...extra });
  const callJob = (body = {}, token = process.env.ONBOARDING_DOCUMENT_DISCARD_SECRET) => job.POST(new NextRequest("http://localhost/api/jobs/hr/onboarding-document-discard", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({}) });
  t.after(async () => {
    for (const ref of refs.reverse()) await ref.firestore.recursiveDelete(ref);
    await Promise.all(objects.map((name) => bucket.file(name).delete({ ignoreNotFound: true })));
    await hrDbAdmin.collection("onboardingDocumentDiscardQueue").doc("onboarding-document-discard-cursor").delete();
    if (previousSecret === undefined) delete process.env.ONBOARDING_DOCUMENT_DISCARD_SECRET; else process.env.ONBOARDING_DOCUMENT_DISCARD_SECRET = previousSecret;
  });
  await t.test("o serviço recusa chamada sem segredo e não varre cancelamentos sem marcador", async () => {
    assert.equal((await callJob({}, "")).status, 401);
    const old = await parent("discard-old-without-opt-in", { documentDiscard: null });
    const path = await put(`hr/onboarding/${old.id}/old.pdf`, { onboardingId: old.id });
    assert.equal((await callJob()).status, 200);
    assert.equal((await bucket.file(path).exists())[0], true);
  });
  await t.test("cursores atravessam objetos preservados e apagam os demais; revisão de escopo permite retomada", async () => {
    const ref = await parent("discard-many-objects");
    const protectedPaths = [];
    for (let index = 0; index < 5; index++) protectedPaths.push(await put(`hr/onboarding/${ref.id}/000-${index}.pdf`, { onboardingId: "another-process" }));
    const ownedPaths = [];
    for (let index = 0; index < 8; index++) ownedPaths.push(await put(`hr/onboarding/${ref.id}/100-${index}.pdf`, { onboardingId: ref.id }));
    for (let round = 0; round < 5; round++) assert.equal((await discardCancelledOnboardingDocuments(ref.id, "synthetic-admin")).status, "pending");
    for (const name of ownedPaths) assert.equal((await bucket.file(name).exists())[0], false, name);
    for (const name of protectedPaths) assert.equal((await bucket.file(name).exists())[0], true, name);
    // A separate owner removes its objects; stale blocked hashes cannot keep the queue stuck forever.
    await Promise.all(protectedPaths.map((name) => bucket.file(name).delete()));
    let result;
    for (let round = 0; round < 4; round++) { result = await discardCancelledOnboardingDocuments(ref.id, "synthetic-admin"); if (result.status === "completed") break; }
    assert.equal(result.status, "completed");
  });
  await t.test("pacotes e manifestos de pré-assinatura entram no descarte e o lease serializa chamadas", async () => {
    const ref = await parent("discard-signature-artifacts");
    const main = await seed(dbAdmin, "generatedDocuments", "discard-generated", { onboardingId: ref.id, status: "final", signatureRequestId: "discard-generated-request" });
    const paths = [await put(`signature-packages/${ref.id}/package/pre-signature.pdf`), await put(`signature-packages/${ref.id}/package/manifest.json`), await put("signature-documents/discard-generated/package/pre-signature.pdf"), await put("signature-documents/discard-generated/package/manifest.json")];
    await seed(hrDbAdmin, "hrSignatureRequests", "discard-package", { onboardingId: ref.id, storagePath: paths[0], manifestPath: paths[1] });
    await seed(hrDbAdmin, "hrSignatureRequests", "discard-generated-request", { generatedDocumentId: main.id, storagePath: paths[2], manifestPath: paths[3] });
    await ref.update({ documentDiscardLease: { id: "other-operation", until: Date.now() + 60_000 } });
    assert.equal((await discardCancelledOnboardingDocuments(ref.id, "synthetic-admin")).waitingForOperation, true);
    assert.equal((await bucket.file(paths[0]).exists())[0], true);
    await ref.update({ documentDiscardLease: null });
    assert.equal((await discardCancelledOnboardingDocuments(ref.id, "synthetic-admin")).status, "completed");
    for (const name of paths) assert.equal((await bucket.file(name).exists())[0], false);
    await assert.rejects(submitOpenOnboardingProcess(ref, { status: "reviewing_documents" }, "stale-public-token"), /encerrado/);
    assert.equal((await ref.get()).get("status"), "cancelled");
  });
  await t.test("a fila continua depois de cinco processos bloqueados e isola falhas", async () => {
    for (let index = 0; index < 5; index++) { const ref = await parent(`000-discard-blocked-${index}`); await put(`hr/onboarding/${ref.id}/protected.pdf`, { onboardingId: "another-process" }); }
    const next = await parent("zzz-discard-must-progress");
    const path = await put(`hr/onboarding/${next.id}/own.pdf`, { onboardingId: next.id });
    for (let attempt = 0; attempt < 4; attempt++) assert.equal((await callJob()).status, 200);
    assert.equal((await bucket.file(path).exists())[0], false);
    assert.equal((await next.get()).get("documentDiscard.status"), "completed");
  });
  await t.test("pagamento confirmado não recria documento removido nem altera revisão descartada", async () => {
    const missing = "discard-missing-receipt";
    assert.equal(await projectDocumentReceiptPaid(dbAdmin, { documentId: missing, requestId: "paid-request", paidAt: "2026-11-26" }), false);
    assert.equal((await dbAdmin.collection("generatedDocuments").doc(missing).get()).exists, false);
    const discarded = await seed(dbAdmin, "generatedDocuments", "discard-receipt", { status: "discarded" });
    assert.equal(await projectDocumentReceiptPaid(dbAdmin, { documentId: discarded.id, requestId: "paid-request", paidAt: "2026-11-26" }), false);
    assert.equal((await discarded.get()).get("receiptPaymentStatus"), undefined);
    const revised = await seed(dbAdmin, "generatedDocuments", "revised-receipt", { status: "final", pdfContentHash: "new-revision" });
    assert.equal(await projectDocumentReceiptPaid(dbAdmin, { documentId: revised.id, requestId: "paid-request", paidAt: "2026-11-26", pdfHash: "old-revision" }), false);
  });
  await t.test("gatilhos retomam gerações tardias e não fazem expurgo retroativo sem marcador", async () => {
    const oldUrl = process.env.ONBOARDING_DOCUMENT_DISCARD_URL;
    const url = "http://localhost/api/jobs/hr/onboarding-document-discard";
    process.env.ONBOARDING_DOCUMENT_DISCARD_URL = url;
    assert.equal(process.env.GCLOUD_PROJECT, "demo-coala-repository");
    await import("../../functions/src/app-init.ts");
    const handlers = await import("../../functions/src/onboarding-document-discard.ts");
    const originalFetch = globalThis.fetch; let calls = 0;
    globalThis.fetch = async (input, init) => {
      const target = String(input);
      if (target === url) { calls++; return job.POST(new NextRequest(url, init), { params: Promise.resolve({}) }); }
      assert.match(new URL(target).hostname, /^(localhost|127\.0\.0\.1)$/);
      return originalFetch(input, init);
    };
    try {
      const ref = await parent("discard-late-generation", { documentDiscard: { status: "completed", updatedAt: "previous" } });
      const generated = await seed(dbAdmin, "generatedDocuments", "discard-late-generated", { onboardingId: ref.id, status: "final" });
      const path = await put(`signed-documents/generated/${generated.id}/request/hash/signed.pdf`, { generatedDocumentId: generated.id });
      await handlers.discardLateOnboardingObject.run({ data: { name: path, bucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, metadata: { generatedDocumentId: generated.id } } });
      assert.equal((await bucket.file(path).exists())[0], false);
      assert.equal((await ref.get()).get("documentDiscard.status"), "completed");
      const before = (await ref.get()).data();
      await ref.update({ status: "reviewing_documents", documents: [{ id: "stale" }] });
      const after = (await ref.get()).data();
      await handlers.onboardingDocumentDiscardRequested.run({ params: { onboardingId: ref.id }, data: { before: { data: () => before }, after: { data: () => after } } });
      assert.equal((await ref.get()).get("status"), "cancelled");
      const previousCalls = calls;
      await handlers.discardLateOnboardingObject.run({ data: { name: "hr/onboarding/discard-old-without-opt-in/late.pdf", metadata: { onboardingId: "discard-old-without-opt-in" } } });
      assert.equal(calls, previousCalls, "cancelamento antigo sem decisão de descarte não vira backfill automático");
    } finally {
      globalThis.fetch = originalFetch;
      if (oldUrl === undefined) delete process.env.ONBOARDING_DOCUMENT_DISCARD_URL; else process.env.ONBOARDING_DOCUMENT_DISCARD_URL = oldUrl;
    }
  });
  await t.test("cancelamento exige unidade e workspace do processo antes de apagar", async () => {
    const uid = "discard-scoped-actor", profileId = `${uid}-profile`, email = `${uid}@example.test`, password = "synthetic-local-password";
    await authAdmin.createUser({ uid, email, password }); t.after(() => authAdmin.deleteUser(uid));
    await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
    await seed(dbAdmin, "profiles", profileId, { permissions: { hr: { formalization: { view: true, signatures: { view: true }, onboarding: { manage: true } } } } });
    await seed(dbAdmin, "users", uid, { username: "Synthetic actor", email, profileId, isActive: true, sessionVersion: 0, unitAccessScope: "selected", unitAccessUnitIds: ["discard-unit-a"], profileCompliance: { status: "complete", policyVersion: 1 } });
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST; assert.match(host ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
    const signedIn = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    const { idToken } = await signedIn.json();
    const route = await import("../../src/app/api/hr/onboarding/[id]/route.ts");
    const allowed = await parent("discard-own-unit", { status: "collecting_documents", documentDiscard: null, asoClinicTokenHash: "old-clinic", asoCandidateTokenHash: "old-candidate", accountantTokenHash: "old-accountant" });
    const allowedPath = await put(`hr/onboarding/${allowed.id}/own.pdf`, { onboardingId: allowed.id });
    const allowedResponse = await route.PATCH(new NextRequest(`http://localhost/api/hr/onboarding/${allowed.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", reason: "Encerramento sintético de teste" }) }), { params: Promise.resolve({ id: allowed.id }) });
    assert.equal(allowedResponse.status, 200, JSON.stringify(await allowedResponse.json()));
    assert.equal((await bucket.file(allowedPath).exists())[0], false);
    const cancelled = await allowed.get();
    for (const field of ["asoClinicTokenHash", "asoCandidateTokenHash", "accountantTokenHash"]) assert.equal(cancelled.get(field), null);
    assert.equal(cancelled.get("documentDiscard.storageRecoverySeconds"), 0);
    const signatures = await import("../../src/app/api/hr/onboarding/[id]/signature-documents/route.ts");
    const closed = await signatures.GET(new NextRequest(`http://localhost/api/hr/onboarding/${allowed.id}/signature-documents?package=signed`, { headers: { Authorization: `Bearer ${idToken}` } }), { params: Promise.resolve({ id: allowed.id }) });
    assert.equal(closed.status, 409);
    for (const [id, fields] of [["discard-other-unit", { unitId: "discard-unit-b" }], ["discard-other-workspace", { workspaceId: "other-workspace" }]]) {
      const ref = await parent(id, { status: "collecting_documents", documentDiscard: null, ...fields });
      const path = await put(`hr/onboarding/${id}/keep.pdf`, { onboardingId: id });
      const response = await route.PATCH(new NextRequest(`http://localhost/api/hr/onboarding/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", reason: "Encerramento sintético de teste" }) }), { params: Promise.resolve({ id }) });
      assert.equal(response.status, 403); assert.equal((await ref.get()).get("status"), "collecting_documents"); assert.equal((await bucket.file(path).exists())[0], true);
    }
  });
});
