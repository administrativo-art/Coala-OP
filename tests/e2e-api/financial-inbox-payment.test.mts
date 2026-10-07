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

  const confirmedInboxId = "inbox-confirmed-document-e2e";
  const forecastId = "forecast-confirmed-document-e2e";
  const confirmedBarcode = "10491158171700010004400014406375415900000146798";
  const accounts = [
    ["account-condominio-e2e", "Condomínio", 50_000],
    ["account-energia-e2e", "Energia elétrica", 91_798],
    ["account-publicidade-e2e", "Publicidade geral | offline", 5_000],
  ] as const;
  await Promise.all(accounts.map(([id, name]) => financial.collection("accounts").doc(id).set({
    name,
    active: true,
    is_dre_account: true,
    isGroup: false,
  })));
  await financial.collection("expenses").doc(forecastId).set({
    workspaceId: "coala",
    description: "Condomínio e energia - Shopping do Automóvel",
    supplier: "OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA",
    status: "provisioned",
    provisionType: "forecast",
    provisionCompetence: "2026-09",
    totalValue: 1_467.98,
    dueDate: Timestamp.fromDate(new Date("2026-10-05T15:00:00Z")),
    accountPlan: accounts[0][0],
    accountId: accounts[0][0],
    accountPlanName: accounts[0][1],
    createdAt: Timestamp.now(),
  });
  await financial.collection("financialInboxMessages").doc(confirmedInboxId).set({
    workspaceId: "coala",
    status: "document_pending",
    subject: "Boleto do Shopping do Automóvel",
    receivedAt: "2026-10-06T12:00:00.000Z",
    linkedExpenseId: null,
    classification: {
      documentType: "charge",
      financeLikely: true,
      confidence: "medium",
      supplierName: "Supplymidia",
      competence: null,
      dueDate: "2026-10-05",
      amountCents: 146_798,
      barcode: null,
      barcodeMasked: null,
      links: [],
      billingIdentity: null,
      fiscalIdentity: null,
    },
    createdAt: "2026-10-06T12:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z",
  });
  const confirmedPath = `/api/financial/inbox/${confirmedInboxId}/link`;
  const confirmedBody = {
    provisionExpenseId: forecastId,
    documentConfirmation: {
      amountCents: 146_798,
      dueDate: "2026-10-05",
      competence: "2026-09",
      barcode: confirmedBarcode,
      supplierName: "OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA",
      supplierTaxId: "05695860000100",
    },
    accountAllocations: accounts.map(([accountPlanId, , amountCents]) => ({ accountPlanId, amountCents })),
  };
  const link = (body: Record<string, unknown>) => fetch(origin + confirmedPath, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const divergent = await link({
    ...confirmedBody,
    documentConfirmation: { ...confirmedBody.documentConfirmation, dueDate: "2026-10-04" },
  });
  assert.equal(divergent.status, 409, `${await divergent.text()}\n${logs}`);

  const linked = await link(confirmedBody);
  const linkedPayload = await linked.json();
  assert.equal(linked.status, 200, `${JSON.stringify(linkedPayload)}\n${logs}`);
  assert.equal(linkedPayload.expenseId, `inbox_${confirmedInboxId}`);
  const [actualSnapshot, messageSnapshot, forecastSnapshot] = await Promise.all([
    financial.collection("expenses").doc(`inbox_${confirmedInboxId}`).get(),
    financial.collection("financialInboxMessages").doc(confirmedInboxId).get(),
    financial.collection("expenses").doc(forecastId).get(),
  ]);
  assert.equal(actualSnapshot.get("totalValue"), 1_467.98);
  assert.equal(actualSnapshot.get("supplier"), "OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA");
  assert.deepEqual(actualSnapshot.get("accountAllocations").map((allocation: { amount: number }) => allocation.amount), [500, 917.98, 50]);
  assert.equal(messageSnapshot.get("status"), "linked");
  assert.equal(messageSnapshot.get("classification.barcode"), confirmedBarcode);
  assert.equal(messageSnapshot.get("classification.competence"), "2026-09");
  assert.equal(messageSnapshot.get("linkedProvisionId"), forecastId);
  assert.equal(forecastSnapshot.get("status"), "reconciled");
  // Este E2E nunca autoriza nem envia ao banco; usa somente emuladores locais.
});
