import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
import { boletoFixture } from "../helpers/boleto-fixture";

const projectId = "demo-coala-boleto";
assertFirestoreEmulatorSafety({ projectId });
for (const key of ["FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) assert.match(process.env[key] ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
const app = initializeApp({ projectId }), db = getFirestore(app, "coala"), financial = getFirestore(app, "coala-financeiro"), auth = getAuth(app);
const origin = "http://127.0.0.1:3106";
const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const competenceMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);
test("API E2E: anexa PDF, prepara uma ordem, preserva competência e bloqueia duplicidade/permissão", { timeout: 240000 }, async t => {
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3106"], { env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-4000); });
  t.after(async () => { server.kill("SIGTERM"); await new Promise(resolve => server.once("exit", resolve)); });
  for (let i = 0; i < 90; i++) { try { await fetch(`${origin}/login`); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
  async function user(uid: string, admin: boolean) {
    await auth.createUser({ uid, email: `${uid}@coala.test`, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin: admin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin: admin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({ username: uid, email: `${uid}@coala.test`, profileId: uid, isActive: true, phone: "5598999999999", birthDate: "1990-01-01", profileCompliance: { status: "complete", policyVersion: 1, missingFields: [], invalidFields: [], evaluatedAt: now, completedAt: now, lastConfirmedAt: now, nextReviewAt: "2099-01-01T00:00:00Z" } });
    const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@coala.test`, password: "test-only-password", returnSecureToken: true }) });
    const credentials = await r.json(); assert.equal(r.status, 200); assert.equal(typeof credentials.idToken, "string"); return credentials.idToken as string;
  }
  const token = await user("boleto-admin", true), restricted = await user("boleto-restricted", false);
  const id = "expense-boleto-e2e", path = `/api/financial/expenses/${id}/boleto`;
  await financial.collection("expenses").doc(id).set({ workspaceId: "coala", status: "provisioned", provisionType: "forecast", paymentMethod: "single", totalValue: 3000, competenceMonth, dueDate: Timestamp.fromDate(new Date(`${dueDate}T15:00:00Z`)), description: "Aluguel de teste", installments: [{ number: 1, status: "provisioned" }] });
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
  function form() {
    const body = new FormData(); body.set("file", new Blob([pdf], { type: "application/pdf" }), "boleto-teste.pdf");
    for (const [key, value] of Object.entries({ barcode: boletoFixture(dueDate), amountCents: "300000", dueDate, competenceMonth, beneficiaryDocument: "11222333000181", documentReference: "TEST-1", confirmed: "true" })) body.set(key, value);
    return body;
  }
  const upload = await fetch(origin + path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form() });
  assert.equal(upload.status, 200, `${await upload.text()}\n${logs}`);
  const downloaded = await fetch(origin + path, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
  const denied = await fetch(origin + path, { headers: { Authorization: `Bearer ${restricted}` } }); assert.equal(denied.status, 403);
  const deniedUpload = await fetch(origin + path, { method: "POST", headers: { Authorization: `Bearer ${restricted}` }, body: form() }); assert.equal(deniedUpload.status, 403);
  const send = (access: string) => fetch(origin + path + "/payment", { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ scheduledFor: dueDate, confirmed: true }) });
  const deniedPrepare = await send(restricted); assert.equal(deniedPrepare.status, 403);
  const results = await Promise.all([send(token), send(token)]);
  const requests = await Promise.all(results.map(async r => { const payload = await r.json(); assert.equal(r.status, 200, JSON.stringify(payload)); return payload.request; }));
  assert.equal(requests[0].id, requests[1].id); assert.equal(requests[0].sourceType, "expense_boleto"); assert.equal(requests[0].barcodeSnapshot.beneficiaryDocument, "11222333000181");
  assert.equal((await financial.collection("financialInboxMessages").limit(1).get()).size, 0);
  const expense = await financial.collection("expenses").doc(id).get(); assert.equal(expense.get("competenceMonth"), competenceMonth); assert.equal(expense.get("status"), "provisioned");
  await financial.collection("expenses").doc(id).update({ status: "paid" });
  assert.equal((await send(token)).status, 409);
  // This E2E never calls submit: no bank credentials, browser or real transfer.
});
