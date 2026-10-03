import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-boleto";
assertFirestoreEmulatorSafety({ projectId });
const app = initializeApp({ projectId });
const db = getFirestore(app, "coala");
const financial = getFirestore(app, "coala-financeiro");
const hr = getFirestore(app, "coala-rh");
const auth = getAuth(app);
const origin = "http://127.0.0.1:3110";
const scheduledFor = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

test("API E2E: cria salário idempotente e bloqueia divergência e falta de permissão", { timeout: 240_000 }, async (context) => {
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3110"], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });
  }
  context.after(async () => {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await fetch(`${origin}/login`);
      break;
    } catch {
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

  const adminToken = await createUser("salary-admin", true);
  const restrictedToken = await createUser("salary-restricted", false);
  const employeeDocumentId = "salary-employee-hr";
  const employeeAuthId = "salary-employee-auth";
  const expenseId = "salary_202609_salary-employee-auth";
  const description = "Salário - 09/2026 | Pessoa Teste";

  const employee = hr.collection("employees").doc(employeeDocumentId);
  await employee.set({ name: "Pessoa Teste", status: "active", auth_uid: employeeAuthId, synced_at: Timestamp.now() });
  await employee.collection("field_values").doc("employee.cpf").set({ value_text: "12345678901" });
  await employee.collection("field_values").doc("employee.pix_key").set({ value_text: "12345678901", updated_at: Timestamp.now() });
  await financial.collection("expenses").doc(expenseId).set({
    workspaceId: "coala",
    status: "pending",
    provisionType: "actual",
    payrollEarningType: "salary",
    employeeId: employeeAuthId,
    totalValue: 1768.82,
    description,
  });

  const payload = {
    sourceType: "salary",
    sourceId: expenseId,
    expenseId,
    beneficiaryReference: { sourceType: "employee", sourceId: employeeDocumentId },
    amount: 1768.82,
    description,
    scheduledFor,
  };
  const create = (token: string, body = payload) => fetch(`${origin}/api/financial/payment-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const denied = await create(restrictedToken);
  assert.equal(denied.status, 403);

  const first = await create(adminToken);
  const firstBody = await first.json();
  assert.equal(first.status, 201, `${JSON.stringify(firstBody)}\n${logs}`);
  assert.equal(firstBody.request.sourceType, "salary");
  assert.equal(firstBody.request.status, "awaiting_financial_authorization");
  assert.equal(firstBody.request.expenseId, expenseId);
  assert.equal((await financial.collection("expenses").doc(expenseId).get()).get("paymentRequestId"), firstBody.request.id);

  const repeated = await create(adminToken);
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 201, JSON.stringify(repeatedBody));
  assert.equal(repeatedBody.request.id, firstBody.request.id);

  const divergentExpenseId = `${expenseId}-divergent`;
  await financial.collection("expenses").doc(divergentExpenseId).set({
    workspaceId: "coala",
    status: "pending",
    provisionType: "actual",
    payrollEarningType: "salary",
    employeeId: employeeAuthId,
    totalValue: 1768.82,
    description,
  });
  const divergent = await create(adminToken, {
    ...payload,
    sourceId: divergentExpenseId,
    expenseId: divergentExpenseId,
    amount: 1768.81,
  });
  assert.equal(divergent.status, 400);
  assert.equal((await financial.collection("bankPaymentRequests").where("sourceType", "==", "salary").get()).size, 1);
  // O E2E termina antes de autorização/envio: não há credenciais bancárias nem transferência real.
});
