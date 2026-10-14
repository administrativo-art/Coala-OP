import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const PROJECT_ID = "demo-coala-repository";
assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });

const { authAdmin, dbAdmin } = await import("../../src/lib/firebase-admin.ts");
const requestsRoute = await import("../../src/app/api/privacy/requests/route.ts");
const requestRoute = await import("../../src/app/api/privacy/requests/[id]/route.ts");
const auditRoute = await import("../../src/app/api/audit/log/route.ts");

const uid = "privacy-permissions-user";
const profileId = "privacy-permissions-profile";
const email = "privacy-permissions@example.test";
const password = "privacy-password-123";

async function token() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(host && /^(127\.0\.0\.1|localhost):\d+$/.test(host));
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}

function request(path, idToken, init = {}) {
  return new NextRequest(`http://localhost${path}`, { ...init, headers: { Authorization: `Bearer ${idToken}`, ...(init.headers ?? {}) } });
}

async function cleanup() {
  const logs = await dbAdmin.collection("actionLogs").where("user_id", "==", uid).get();
  const batch = dbAdmin.batch();
  logs.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(dbAdmin.collection("privacyRequests").doc("existing-request"));
  batch.delete(dbAdmin.collection("profiles").doc(profileId));
  batch.delete(dbAdmin.collection("users").doc(uid));
  await batch.commit();
  await authAdmin.deleteUser(uid).catch(() => undefined);
}

test("leitor consulta privacidade sem mutar; gestor muta e origem da auditoria é explícita", async (t) => {
  await authAdmin.createUser({ uid, email, password });
  await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
  await dbAdmin.collection("profiles").doc(profileId).set({ permissions: { settings: { view: true } } });
  await dbAdmin.collection("users").doc(uid).set({ username: "Privacy Reader", email, profileId, isActive: true, sessionVersion: 0, profileCompliance: { status: "complete", policyVersion: 1 } });
  await dbAdmin.collection("privacyRequests").doc("existing-request").set({ workspace_id: "coala", subjectName: "Titular", status: "open", createdAt: new Date(), updatedAt: new Date() });
  t.after(cleanup);
  const idToken = await token();

  const list = await requestsRoute.GET(request("/api/privacy/requests", idToken), { params: Promise.resolve({}) });
  assert.equal(list.status, 200);
  const deniedCreate = await requestsRoute.POST(request("/api/privacy/requests", idToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectName: "Novo", subjectType: "employee", requestType: "access", origin: "email", description: "Pedido" }) }), { params: Promise.resolve({}) });
  assert.equal(deniedCreate.status, 403);
  const deniedUpdate = await requestRoute.PATCH(request("/api/privacy/requests/existing-request", idToken, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) }), { params: Promise.resolve({ id: "existing-request" }) });
  assert.equal(deniedUpdate.status, 403);

  await dbAdmin.collection("profiles").doc(profileId).set({ permissions: { settings: { view: true, manageUsers: true } } });
  const allowedCreate = await requestsRoute.POST(request("/api/privacy/requests", idToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectName: "Novo", subjectType: "employee", requestType: "access", origin: "email", description: "Pedido" }) }), { params: Promise.resolve({}) });
  assert.equal(allowedCreate.status, 201);

  const clientEvent = await auditRoute.POST(request("/api/audit/log", idToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: "settings.users", action: "user_updated" }) }), { params: Promise.resolve({}) });
  assert.equal(clientEvent.status, 200);
  const logs = await dbAdmin.collection("actionLogs").where("user_id", "==", uid).get();
  assert.ok(logs.docs.some((doc) => doc.get("trust_source") === "server-authoritative" && doc.get("event_namespace") === "privacy"));
  assert.ok(logs.docs.some((doc) => doc.get("trust_source") === "client-declared" && doc.get("event_namespace") === "client"));
});
