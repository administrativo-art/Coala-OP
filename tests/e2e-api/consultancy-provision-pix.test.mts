import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-consultancy";
assertFirestoreEmulatorSafety({ projectId });
const app = initializeApp({ projectId });
const db = getFirestore(app, "coala");
const financial = getFirestore(app, "coala-financeiro");
const hr = getFirestore(app, "coala-rh");
const auth = getAuth(app);
const origin = "http://127.0.0.1:3112";
const today = new Date();
const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + (today.getUTCDate() >= 20 ? 1 : 0), 20));
const scheduledFor = due.toISOString().slice(0, 10);
const competence = scheduledFor.slice(0, 7);
const displayMonth = `${competence.slice(5)}/${competence.slice(0, 4)}`;

test("consultancy Pix: protected HTTP preparation, idempotence and pre-bank source revalidation", { timeout: 240_000 }, async (context) => {
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3112"], {
    env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });
  context.after(async () => { server.kill("SIGTERM"); await new Promise((resolve) => server.once("exit", resolve)); });
  for (let attempt = 0; attempt < 90; attempt++) {
    try { await fetch(`${origin}/login`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }

  async function createUser(uid: string, admin: boolean) {
    const email = `${uid}@coala.test`;
    await auth.createUser({ uid, email, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin: admin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin: admin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({ username: uid, email, profileId: uid, isActive: true, phone: "5598999999999", birthDate: "1990-01-01",
      profileCompliance: { status: "complete", policyVersion: 1, missingFields: [], invalidFields: [], evaluatedAt: now, completedAt: now, lastConfirmedAt: now, nextReviewAt: "2099-01-01T00:00:00Z" } });
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "test-only-password", returnSecureToken: true }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    return payload.idToken as string;
  }

  const token = await createUser("consultancy-admin", true);
  const restricted = await createUser("consultancy-restricted", false);
  const employeeId = "consultancy-employee";
  const contractDocumentId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const forecastId = `provision_consultancy_${competence.replace("-", "_")}`;
  const actualId = `consultancy_actual_${forecastId}`;
  const description = `Consultoria de RH - ${displayMonth} | Isabela Dominici Silva`;
  const employeeRef = hr.collection("employees").doc(employeeId);
  await employeeRef.set({ name: "ISABELA DOMINICI SILVA", status: "active", synced_at: Timestamp.now() });
  await employeeRef.collection("field_values").doc("employee.cpf").set({ value_text: "12345678901" });
  await employeeRef.collection("field_values").doc("employee.pix_key").set({ value_text: "91999999999", updated_at: Timestamp.now() });
  await employeeRef.collection("field_values").doc("employee.pix_key_type").set({ value_text: "phone", updated_at: Timestamp.now() });
  await hr.collection("employeeDocuments").doc(contractDocumentId).set({ employeeId, documentTypeCode: "SERVICE_PROVIDER_CONTRACT_ADDENDUM", status: "validated",
    contentHash: "b".repeat(64), extractedFields: { startDate: "2025-01-01", endDate: "2099-12-31" } });
  const forecastRef = financial.collection("expenses").doc(forecastId);
  await forecastRef.set({ status: "provisioned", provisionType: "forecast", provisionSeriesKey: "recurring:consultoria-rh:isabela-dominici-silva",
    provisionCompetence: competence, competenceMonth: competence, supplier: "Isabela Dominici Silva", description, totalValue: 1050.78,
    dueDate: Timestamp.fromDate(new Date(`${scheduledFor}T15:00:00Z`)),
    installments: [{ number: 1, dueDate: Timestamp.fromDate(new Date(`${scheduledFor}T15:00:00Z`)), value: 1050.78, status: "pending" }],
  });
  const path = `/api/financial/expenses/${forecastId}/consultancy-pix`;
  const body = JSON.stringify({ beneficiaryEmployeeId: employeeId, scheduledFor });
  const prepare = (access: string) => fetch(origin + path, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body });

  const denied = await prepare(restricted);
  assert.equal(denied.status, 403);
  const unbound = await prepare(token);
  assert.ok(unbound.status >= 400, `${unbound.status} ${await unbound.text()}`);
  assert.equal((await financial.collection("expenses").doc(actualId).get()).exists, false);
  assert.equal((await financial.collection("bankPaymentRequests").get()).size, 0);

  const direct = await fetch(`${origin}/api/financial/payment-requests`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "consultancy_provision", sourceId: forecastId, expenseId: actualId, beneficiaryReference: { sourceType: "employee", sourceId: employeeId }, amount: 1050.78, description, scheduledFor }) });
  assert.equal(direct.status, 403);

  await forecastRef.update({ consultancyEmployeeId: employeeId, consultancyContractDocumentId: contractDocumentId });
  const first = await prepare(token);
  const firstBody = await first.json();
  assert.equal(first.status, 200, `${JSON.stringify(firstBody)}\n${logs}`);
  const request = firstBody.request;
  assert.equal(request.sourceType, "consultancy_provision");
  assert.equal(request.expenseId, actualId);
  assert.equal(request.status, "awaiting_financial_authorization");
  const forecast = await forecastRef.get();
  const actual = await financial.collection("expenses").doc(actualId).get();
  assert.equal(forecast.get("status"), "reconciled");
  assert.equal(forecast.get("replacedByExpenseId"), actualId);
  assert.equal(actual.get("provisionType"), "actual");
  assert.equal(actual.get("paymentRequestId"), request.id);
  assert.equal(actual.get("installments")[0].paymentRequestId, request.id);
  const repeated = await prepare(token);
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200, JSON.stringify(repeatedBody));
  assert.equal(repeatedBody.request.id, request.id);
  assert.equal((await financial.collection("bankPaymentRequests").get()).size, 1);

  const authResponse = await fetch(`${origin}/api/financial/payment-requests/${request.id}/authorize`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const authBody = await authResponse.json();
  assert.equal(authResponse.status, 200, JSON.stringify(authBody));
  assert.equal(authBody.request.status, "ready_to_submit");
  const { submitPaymentRequest } = await import("../../src/features/financial/payment-requests/service.server");
  await financial.collection("expenses").doc(actualId).update({ totalValue: 1050.79 });
  await assert.rejects(submitPaymentRequest(request.id, { uid: "consultancy-admin", email: "consultancy-admin@coala.test" }), /divergem|mudaram/);
  assert.equal((await financial.collection("bankPaymentRequests").doc(request.id).get()).get("status"), "ready_to_submit");
  await financial.collection("expenses").doc(actualId).update({ totalValue: 1050.78 });
  await financial.collection("payments").doc("duplicate-test").set({ expenseId: actualId, workspaceId: "coala", totalPaid: 1050.78, reversed: false });
  await assert.rejects(submitPaymentRequest(request.id, { uid: "consultancy-admin", email: "consultancy-admin@coala.test" }), /mudaram/);
  assert.equal((await financial.collection("bankPaymentRequests").doc(request.id).get()).get("status"), "ready_to_submit");
  // No request reaches Inter: both submit attempts fail during the Firestore preflight transaction.
});
