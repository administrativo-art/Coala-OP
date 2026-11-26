/* eslint-disable @typescript-eslint/no-explicit-any -- Heterogeneous Firestore records and test ports are intentionally isolated from production SDK types. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { serverModuleLoader } from "../helpers/load-server-module";

type Data = Record<string, any>; // Firestore test port accepts heterogeneous source records.
function database() {
  const rows = new Map<string, Data>();
  let tail = Promise.resolve();
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)), get: (key: string) => key.split(".").reduce((value, part) => value?.[part], rows.get(path)) });
  const doc = (path: string): any => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path), collection: (name: string) => collection(`${path}/${name}`), set: async (data: Data, options?: { merge?: boolean }) => rows.set(path, options?.merge ? { ...rows.get(path), ...data } : data) });
  const collection = (path: string) => ({ doc: (id: string) => doc(`${path}/${id}`) });
  return {
    rows, collection,
    async runTransaction<T>(run: (transaction: any) => Promise<T>) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((done) => { release = done; });
      await previous;
      const writes: Array<() => void> = [];
      try {
        const result = await run({
          get: async (ref: { path: string }) => snapshot(ref.path),
          create: (ref: { path: string }, data: Data) => writes.push(() => { assert.equal(rows.has(ref.path), false); rows.set(ref.path, structuredClone(data)); }),
          set: (ref: { path: string }, data: Data) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...data })),
        });
        writes.forEach((write) => write());
        return result;
      } finally { release(); }
    },
  };
}

function fixture(mode: "accepted" | "uncertain" | "prepared" = "accepted") {
  const primary = database(), financial = database();
  const bankCalls: string[] = [];
  const actor: Data = { uid: "operator", decoded: { uid: "operator" }, userDoc: {}, workspace_id: "coala", isDefaultAdmin: true, permissions: {} };
  let scopeAllowed = true;
  let interrupted = false;
  const beneficiary = { sourceType: "employee", sourceId: "employee-1", name: "Pessoa de teste", document: "12345678901", pixKey: "test@example.test", pixKeyType: "email", validated: true, sourceUpdatedAt: "v1" };
  const load = serverModuleLoader({
    "@/lib/firebase-admin": { dbAdmin: primary },
    "@/lib/firebase-financial-admin": { financialDbAdmin: financial },
    "@/lib/workspace": { WORKSPACE_ID: "coala" },
    "@/lib/company/internal-company-repository": { InternalCompanyRepository: class { async findByCnpj() { return { id: "company-1", name: "Empresa de teste", status: "active" }; } } },
    "@/features/hr/documents/generation-access.server": { assertGenerationPersonScopes: async () => { if (!scopeAllowed) throw new Error("scope denied"); } },
    "./client.server": { createInterClient: () => { throw new Error("Network forbidden in test"); } },
    "../beneficiaries/resolver.server": { resolvePaymentBeneficiary: async () => beneficiary, createBeneficiarySnapshot: (row: Data) => ({ sourceId: row.sourceId, sourceUpdatedAt: row.sourceUpdatedAt }) },
    "./repository.server": { paymentRequestRef: (id: string) => financial.collection("bankPaymentRequests").doc(id) },
    "./service.server": {
      // The shared submission port reserves submitting atomically, as its existing implementation does.
      submitPaymentRequest: async (id: string) => {
        if (mode === "prepared" && !interrupted) { interrupted = true; throw new Error("interrupted before bank submission"); }
        const ref = financial.collection("bankPaymentRequests").doc(id);
        const current = await financial.runTransaction(async (tx) => {
          const row = await tx.get(ref);
          if (row.get("status") !== "ready_to_submit") throw new Error("already reserved");
          tx.set(ref, { status: "submitting", submissionStartedAt: "now" });
          return row.data();
        });
        bankCalls.push(current.idempotencyKey);
        if (mode === "uncertain") throw new Error("simulated lost bank response");
        const result = { ...current, id, status: "awaiting_bank_approval", interRequestId: "fake-bank-1" };
        await ref.set(result);
        return result;
      },
    },
  });
  const receipt = load("src/features/hr/documents/receipt-payment.ts") as Data;
  const snapshot = receipt.receiptPaymentSnapshot({ receipt: {
    direction: "Pagamos", items: [{ value: 1000.29 }], payment: { method: "pix", pixKey: beneficiary.pixKey },
    issuer: { snapshot: { document: "14276603000125" } }, recipient: { snapshot: { document: beneficiary.document } },
  } });
  primary.rows.set("generatedDocuments/receipt-1", { templateId: "system-receipt-standard", status: "approved", workspaceId: "coala", pdfStoragePath: "fake.pdf", pdfContentHash: "pdf-v1", formValuesHash: "form-v1", missingRequired: [], parties: [{ role: "issuer", partyType: "company", ref: "company-1" }, { role: "recipient", partyType: "employee", ref: beneficiary.sourceId }] });
  primary.rows.set("generatedDocuments/receipt-1/audit/resolvedValues", { receiptPaymentSnapshot: snapshot });
  const service = load("src/features/financial/payment-requests/document-receipt.server.ts") as Data;
  return { primary, financial, bankCalls, actor, snapshot, beneficiary, service, denyScope: () => { scopeAllowed = false; } };
}

test("receipt service: concurrent and repeated requests create one ledger entry and one bank instruction", async () => {
  const previous = { flag: process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED, payer: process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ };
  process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED = "true";
  process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ = "14276603000125";
  try {
    const f = fixture();
    const results = await Promise.allSettled([f.service.sendDocumentReceiptPayment("receipt-1", f.actor), f.service.sendDocumentReceiptPayment("receipt-1", f.actor)]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    assert.equal(f.bankCalls.length, 1);
    await f.service.sendDocumentReceiptPayment("receipt-1", f.actor);
    assert.equal(f.bankCalls.length, 1);
    assert.equal([...f.financial.rows.keys()].filter((key) => key.split("/").length === 2).length, 1);
    assert.equal([...f.financial.rows.keys()].filter((key) => key.includes("/events/")).length, 1);
    const status = await f.service.readDocumentReceiptPaymentStatus("receipt-1", f.actor);
    assert.equal(status.status, "awaiting_bank_approval");
  } finally {
    if (previous.flag === undefined) delete process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED; else process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED = previous.flag;
    if (previous.payer === undefined) delete process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ; else process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ = previous.payer;
  }
});

test("receipt service: lost bank response is never blindly resubmitted; divergences never call bank", async () => {
  const flag = process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED, payer = process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ;
  process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED = "true";
  process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ = "14276603000125";
  try {
    const uncertain = fixture("uncertain");
    await assert.rejects(uncertain.service.sendDocumentReceiptPayment("receipt-1", uncertain.actor), /lost bank response/);
    await uncertain.service.sendDocumentReceiptPayment("receipt-1", uncertain.actor);
    assert.equal(uncertain.bankCalls.length, 1);
    assert.equal((await uncertain.service.readDocumentReceiptPaymentStatus("receipt-1", uncertain.actor)).canResume, false);
    const prepared = fixture("prepared");
    await assert.rejects(prepared.service.sendDocumentReceiptPayment("receipt-1", prepared.actor), /interrupted before/);
    assert.equal((await prepared.service.readDocumentReceiptPaymentStatus("receipt-1", prepared.actor)).canResume, true);
    const original = [...prepared.financial.rows.values()].find((row) => row.sourceType === "document_receipt")!;
    const resumed = await prepared.service.sendDocumentReceiptPayment("receipt-1", prepared.actor);
    assert.equal(resumed.reused, true);
    assert.deepEqual(prepared.bankCalls, [original.idempotencyKey]);
    assert.equal([...prepared.financial.rows.keys()].filter((key) => key.includes("/events/")).length, 1);
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.snapshot.pixKeyHash = "0".repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.snapshot.recipientDocumentHash = "0".repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.snapshot.issuerDocumentHash = "0".repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.primary.rows.get("generatedDocuments/receipt-1")!.workspaceId = "other"; },
      (f: ReturnType<typeof fixture>) => { f.primary.rows.get("generatedDocuments/receipt-1")!.pdfStoragePath = null; },
      (f: ReturnType<typeof fixture>) => { f.primary.rows.get("generatedDocuments/receipt-1")!.status = "review_pending"; },
      (f: ReturnType<typeof fixture>) => f.denyScope(),
    ]) {
      const f = fixture(); change(f);
      await assert.rejects(f.service.sendDocumentReceiptPayment("receipt-1", f.actor));
      assert.equal(f.bankCalls.length, 0);
      assert.equal(f.financial.rows.size, 0);
    }
  } finally {
    if (flag === undefined) delete process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED; else process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED = flag;
    if (payer === undefined) delete process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ; else process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ = payer;
  }
});

test("receipt HTTP controller: permission, injected payment data and invalid IDs are rejected before service", async () => {
  let calls = 0;
  const allowed: Data = { decoded: { uid: "operator" }, workspace_id: "coala", userDoc: { username: "Operator" }, isDefaultAdmin: false, permissions: {
    hr: { formalization: { documents: { view: true } } },
    financial: { view: true, paymentRequests: { view: true, create: true, authorize: true, submit: true } },
  } };
  let actor = structuredClone(allowed);
  class TestAppError extends Error { code: string; constructor(options: Data) { super(options.safeMessage ?? options.code); this.code = options.code; } }
  const load = serverModuleLoader({
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } },
    "@/features/financial/payment-requests/document-receipt.server": { sendDocumentReceiptPayment: async () => { calls++; return { request: { status: "awaiting_bank_approval" } }; }, readDocumentReceiptPaymentStatus: async () => { calls++; return null; } },
    "@/lib/auth-server": { requireUser: async () => actor },
    "@/lib/integrations/inter/config.server": { isInterConfigured: () => true },
    "@/lib/observability/app-error": { AppError: TestAppError },
    "@/lib/server-authentication-failure": { rethrowServerAuthenticationFailure: (error: unknown) => { throw error; } },
    "@/lib/security/route-contract": { defineSecurityContract: (contract: unknown) => contract },
    "@/lib/security/enforcer": { defineSecurityEnforcer: (enforcer: unknown) => enforcer },
    "@/lib/security/secure-route.server": { secureRoute: ({ enforcer }: any, handler: any) => async (request: Request, context: unknown) => handler({ security: await enforcer.enforce({ request, routeContext: context }) }) },
  });
  const route = load("src/app/api/documents/generated/[id]/payment/route.ts") as Data;
  const post = (body?: string, id = "receipt-1") => route.POST(new Request("http://localhost/api/documents/generated/receipt-1/payment", { method: "POST", body }), { params: Promise.resolve({ id }) });
  for (const privilege of ["view", "create", "authorize", "submit"]) {
    actor = structuredClone(allowed); actor.permissions.financial.paymentRequests[privilege] = false;
    await assert.rejects(post(), { code: "DOCUMENT_RECEIPT_PAYMENT_FORBIDDEN" });
  }
  actor = structuredClone(allowed); actor.permissions.hr.formalization.documents.view = false;
  await assert.rejects(post(), { code: "DOCUMENT_RECEIPT_PAYMENT_FORBIDDEN" });
  actor = structuredClone(allowed);
  await assert.rejects(post(JSON.stringify({ amount: 0.01, beneficiary: "other" })), { code: "DOCUMENT_RECEIPT_PAYMENT_BODY_INVALID" });
  await assert.rejects(post(undefined, "bad/id"), { code: "DOCUMENT_RECEIPT_PAYMENT_ID_INVALID" });
  assert.equal(calls, 0);
  const response = await post();
  assert.equal((await response.json()).request.status, "awaiting_bank_approval");
  assert.equal(calls, 1);
});
