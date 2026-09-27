import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-boleto";
assertFirestoreEmulatorSafety({ projectId });
for (const key of ["FIREBASE_AUTH_EMULATOR_HOST"]) assert.match(process.env[key] ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
const app = initializeApp({ projectId }, "financial-inbox-payment-e2e");
const db = getFirestore(app, "coala"), financial = getFirestore(app, "coala-financeiro"), auth = getAuth(app);
const origin = "http://127.0.0.1:3107";

test("API E2E: prepara cobrança da caixa com CNPJ confirmado e bloqueia divergência/permissão", { timeout: 240000 }, async (t) => {
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3107"], {
    env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-4000); });
  t.after(async () => { server.kill("SIGTERM"); await new Promise((resolve) => server.once("exit", resolve)); });
  for (let i = 0; i < 90; i++) { try { await fetch(`${origin}/login`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); } }

  async function user(uid: string, admin: boolean) {
    await auth.createUser({ uid, email: `${uid}@coala.test`, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin: admin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin: admin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({ username: uid, email: `${uid}@coala.test`, profileId: uid, isActive: true, phone: "5598999999999", birthDate: "1990-01-01", profileCompliance: { status: "complete", policyVersion: 1, missingFields: [], invalidFields: [], evaluatedAt: now, completedAt: now, lastConfirmedAt: now, nextReviewAt: "2099-01-01T00:00:00Z" } });
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@coala.test`, password: "test-only-password", returnSecureToken: true }) });
    const credentials = await response.json();
    assert.equal(response.status, 200);
    return credentials.idToken as string;
  }

  const token = await user("inbox-payment-admin", true), restricted = await user("inbox-payment-restricted", false);
  const inboxId = "inbox-payment-e2e", expenseId = "expense-inbox-payment-e2e";
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const barcode = "8".repeat(48), beneficiaryDocument = "11222333000181";
  await financial.collection("expenses").doc(expenseId).set({ workspaceId: "coala", status: "pending", paymentMethod: "single", totalValue: 39.99, dueDate: Timestamp.fromDate(new Date(`${dueDate}T15:00:00Z`)), description: "Cobrança recebida de teste" });
  await financial.collection("financialInboxMessages").doc(inboxId).set({
    workspaceId: "coala", status: "linked", subject: "Cobrança de teste", linkedExpenseId: expenseId,
    classification: { amountCents: 3999, dueDate, barcode }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const path = `/api/financial/inbox/${inboxId}/payment`;
  const send = (access: string, body: Record<string, unknown>) => fetch(origin + path, {
    method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await send(token, { scheduledFor: dueDate, barcode })).status, 400);
  assert.equal((await send(token, { scheduledFor: dueDate, barcode, beneficiaryDocument: "00000000000000" })).status, 400);
  assert.equal((await send(restricted, { scheduledFor: dueDate, barcode, beneficiaryDocument })).status, 403);
  const results = await Promise.all([
    send(token, { scheduledFor: dueDate, barcode, beneficiaryDocument }),
    send(token, { scheduledFor: dueDate, barcode, beneficiaryDocument }),
  ]);
  const requests = await Promise.all(results.map(async (response) => {
    const payload = await response.json();
    assert.equal(response.status, 200, `${JSON.stringify(payload)}\n${logs}`);
    return payload.request;
  }));
  assert.equal(requests[0].id, requests[1].id);
  assert.equal(requests[0].barcodeSnapshot.beneficiaryDocument, beneficiaryDocument);
  assert.equal((await financial.collection("financialInboxMessages").doc(inboxId).get()).get("status"), "awaiting_authorization");
  assert.equal((await send(token, { scheduledFor: dueDate, barcode, beneficiaryDocument: "64433090000197" })).status, 400);
  assert.equal((await financial.collection("bankPaymentRequests").where("sourceId", "==", inboxId).get()).size, 1);
  // Este E2E nunca autoriza nem envia ao banco; usa somente emuladores locais.
});
