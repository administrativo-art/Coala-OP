import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { encryptPaymentDestination } from "../../src/features/financial/beneficiaries/security.server";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-boleto";
assertFirestoreEmulatorSafety({ projectId });
const app = initializeApp({ projectId });
const db = getFirestore(app, "coala");
const financial = getFirestore(app, "coala-financeiro");
const auth = getAuth(app);
const origin = "http://127.0.0.1:3113";
const encryptionKey = "ab".repeat(32);

test("API E2E: prepara Pix por despesa e bloqueia envio divergente antes do banco", { timeout: 240_000 }, async (context) => {
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3113"], {
    env: { ...process.env, NODE_ENV: "development", PAYMENT_DATA_ENCRYPTION_KEY: encryptionKey },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });
  }
  context.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await fetch(`${origin}/login`);
      break;
    } catch {
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function createUser(uid: string, isDefaultAdmin: boolean) {
    const email = `${uid}@coala.test`;
    await auth.createUser({ uid, email, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({
      username: uid,
      email,
      profileId: uid,
      isActive: true,
      phone: "5598999999999",
      birthDate: "1990-01-01",
      profileCompliance: {
        status: "complete",
        policyVersion: 1,
        missingFields: [],
        invalidFields: [],
        evaluatedAt: now,
        completedAt: now,
        lastConfirmedAt: now,
        nextReviewAt: "2099-01-01T00:00:00Z",
      },
    });
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "test-only-password", returnSecureToken: true }),
      },
    );
    const credentials = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof credentials.idToken, "string");
    return credentials.idToken as string;
  }

  const token = await createUser("supplier-pix-admin", true);
  const restricted = await createUser("supplier-pix-restricted", false);
  const supplierEntityId = "supplier-pix-entity";
  const document = "11222333000181";
  const expenseId = "supplier-pix-september";
  const expenses = financial.collection("expenses");
  const requests = financial.collection("bankPaymentRequests");
  const profile = financial.collection("supplierPaymentProfiles").doc(supplierEntityId);
  await db.collection("entities").doc(supplierEntityId).set({ name: "Fornecedor de teste", document, status: "active" });
  const now = new Date().toISOString();
  await profile.set({
    active: true, paymentMethod: "pix_key", pixKeyType: "cnpj", holderDocument: document,
    encryptedPaymentData: encryptPaymentDestination({ pixKey: document }, encryptionKey),
    validatedAt: now, updatedAt: now,
  });
  const expense = expenses.doc(expenseId);
  await expense.set({
    workspaceId: "coala", status: "pending", provisionType: "actual", paymentMethod: "single",
    supplierId: supplierEntityId, billingIdentity: { supplierTaxId: document }, totalValue: 536.64,
    description: "Honorário de teste 2026-09", competenceMonth: "2026-09",
    installments: [{ number: 1, value: 536.64, status: "pending" }],
  });

  const post = (path: string, access: string, body?: Record<string, unknown>) => fetch(origin + path, {
    method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const path = `/api/financial/expenses/${expenseId}/supplier-pix`;
  const prepare = (access = token, amountCents = 53664) => post(path, access, { supplierEntityId, amountCents });
  assert.equal((await prepare(restricted)).status, 403);
  assert.equal((await prepare(token, 53665)).status, 409);
  await profile.update({ active: false });
  assert.ok((await prepare()).status >= 400);
  assert.equal((await requests.where("expenseId", "==", expenseId).get()).size, 0);
  await profile.update({ active: true });

  const results = await Promise.all([prepare(), prepare()]);
  const requestId = `expense_supplier_pix_${expenseId}`;
  for (const response of results) {
    const result = await response.json();
    assert.equal(response.status, 200, `${JSON.stringify(result)}\n${logs}`);
    assert.deepEqual(result.request, { id: requestId, status: "awaiting_financial_authorization" });
  }
  assert.equal((await expense.get()).get("paymentRequestId"), requestId);
  assert.equal((await requests.where("expenseId", "==", expenseId).get()).size, 1);
  assert.equal((await requests.doc(requestId).collection("events").get()).size, 1);

  const requestPath = `/api/financial/payment-requests/${requestId}`;
  const authorization = await post(`${requestPath}/authorize`, token);
  const authorized = await authorization.json();
  assert.equal(authorization.status, 200, JSON.stringify(authorized));
  assert.equal(authorized.request.status, "ready_to_submit");
  // The HTTP submit route requires a real Inter configuration. Exercise the service's
  // transaction directly and verify that it rejects each case before reaching Inter.
  const { submitPaymentRequest } = await import("../../src/features/financial/payment-requests/service.server");
  const submit = () => submitPaymentRequest(requestId, { uid: "supplier-pix-admin" });
  await expense.update({ totalValue: 536.65 });
  await assert.rejects(submit, /valor ou a identidade do fornecedor diverge/);
  assert.equal((await requests.doc(requestId).get()).get("status"), "ready_to_submit");
  await expense.update({ totalValue: 536.64 });
  await financial.collection("payments").doc("supplier-pix-existing-payment").set({ expenseId, totalPaid: 536.64 });
  await assert.rejects(submit, /os pagamentos mudaram/);
  const request = await requests.doc(requestId).get();
  assert.equal(request.get("status"), "ready_to_submit");
  assert.equal(request.get("interRequestId"), undefined);
});
