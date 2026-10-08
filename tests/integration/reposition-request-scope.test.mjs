import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const PROJECT_ID = "demo-coala-repository";
assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });

const { authAdmin, dbAdmin } = await import("../../src/lib/firebase-admin.ts");
const collectionRoute = await import("../../src/app/api/stock/reposition-requests/route.ts");
const itemRoute = await import("../../src/app/api/stock/reposition-requests/[requestId]/route.ts");
const uploadRoute = await import("../../src/app/api/uploads/operations/route.ts");

const uid = "reposition-scope-user";
const email = "reposition-scope@example.test";
const password = "scope-password-123";
const now = new Date().toISOString();

async function token() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(host && /^(127\.0\.0\.1|localhost):\d+$/.test(host));
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}

function request(path, idToken, init = {}) {
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${idToken}`, ...(init.headers ?? {}) },
  });
}

async function seed() {
  await authAdmin.createUser({ uid, email, password });
  await authAdmin.setCustomUserClaims(uid, { profileId: "reposition-scope", sessionVersion: 0 });
  const batch = dbAdmin.batch();
  batch.set(dbAdmin.collection("profiles").doc("reposition-scope"), {
    permissions: { stock: { analysis: { restock: true }, purchasing: { approve: true } } },
  });
  batch.set(dbAdmin.collection("users").doc(uid), {
    username: "Reposição Escopo",
    email,
    profileId: "reposition-scope",
    isActive: true,
    sessionVersion: 0,
    unitAccessScope: "selected",
    unitAccessUnitIds: ["unit-a"],
    profileCompliance: { status: "complete", policyVersion: 1 },
  });
  batch.set(dbAdmin.collection("kiosks").doc("unit-a"), { name: "Unidade A" });
  batch.set(dbAdmin.collection("kiosks").doc("unit-b"), { name: "Unidade B" });
  for (const unit of ["a", "b"]) {
    batch.set(dbAdmin.collection("repositionRequests").doc(`request-${unit}`), {
      status: "Pendente",
      kioskId: `unit-${unit}`,
      kioskName: `Unidade ${unit.toUpperCase()}`,
      items: [],
      requestedBy: { userId: "seed", username: "Seed" },
      createdAt: now,
      updatedAt: now,
    });
    batch.set(dbAdmin.collection("purchase_receipts").doc(`receipt-${unit}`), {
      workspaceId: "coala",
      purchaseOrderId: `order-${unit}`,
      destinationKioskId: `unit-${unit}`,
    });
  }
  await batch.commit();
}

async function cleanup() {
  await Promise.all([
    authAdmin.deleteUser(uid).catch(() => undefined),
    dbAdmin.collection("profiles").doc("reposition-scope").delete(),
    dbAdmin.collection("users").doc(uid).delete(),
    ...["unit-a", "unit-b"].map((id) => dbAdmin.collection("kiosks").doc(id).delete()),
    ...["request-a", "request-b"].map((id) => dbAdmin.collection("repositionRequests").doc(id).delete()),
    ...["receipt-a", "receipt-b"].map((id) => dbAdmin.collection("purchase_receipts").doc(id).delete()),
  ]);
}

test("solicitação e upload de reposição isolam unidades e rejeitam campos protegidos", async (t) => {
  await seed();
  t.after(cleanup);
  const idToken = await token();

  const list = await collectionRoute.GET(request("/api/stock/reposition-requests", idToken), { params: Promise.resolve({}) });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).requests.map((entry) => entry.id), ["request-a"]);

  const crossCreate = await collectionRoute.POST(request("/api/stock/reposition-requests", idToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kioskId: "unit-b", items: [{ baseProductId: "base", productName: "Item", unit: "un", currentStock: 0, minimumStock: 1, requestedQuantity: 1 }] }),
  }), { params: Promise.resolve({}) });
  assert.equal(crossCreate.status, 403);

  const forged = await itemRoute.PATCH(request("/api/stock/reposition-requests/request-a", idToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Cancelada", kioskId: "unit-b" }),
  }), { params: Promise.resolve({ requestId: "request-a" }) });
  assert.equal(forged.status, 400);
  assert.equal((await dbAdmin.collection("repositionRequests").doc("request-a").get()).get("status"), "Pendente");

  const crossCancel = await itemRoute.PATCH(request("/api/stock/reposition-requests/request-b", idToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Cancelada" }),
  }), { params: Promise.resolve({ requestId: "request-b" }) });
  assert.equal(crossCancel.status, 403);

  const form = new FormData();
  form.set("kind", "purchase-receipt");
  form.set("targetId", "receipt-b");
  form.set("file", new File([Buffer.from("%PDF-test")], "proof.pdf", { type: "application/pdf" }));
  const crossUpload = await uploadRoute.POST(request("/api/uploads/operations", idToken, { method: "POST", body: form }), { params: Promise.resolve({}) });
  assert.equal(crossUpload.status, 403);
});
