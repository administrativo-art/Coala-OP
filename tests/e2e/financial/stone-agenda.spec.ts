import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

test("Stone agenda denies anonymous and restricted users before contacting Stone", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Auth emulator required");
  const path = "/api/financial/stone-agenda?stoneCode=123456789&referenceDate=2026-09-20";
  expect((await request.get(path)).status()).toBe(401);
  const signup = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    data: { returnSecureToken: true },
  });
  expect(signup.ok()).toBeTruthy();
  const user = await signup.json();
  const app = getApps().find((entry) => entry.name === "stone-agenda-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "stone-agenda-e2e");
  const db = getFirestore(app, "coala");
  // No profile and no privileged claims: this identity must not reach the provider.
  await db.collection("users").doc(user.localId).set({
    isActive: true, assignedKioskIds: [],
    profileCompliance: { status: "complete", policyVersion: 1 },
  });
  const denied = await request.get(path, { headers: { Authorization: `Bearer ${user.idToken}` } });
  expect(denied.status()).toBe(403);

  const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
  });
  expect(login.ok()).toBeTruthy();
  const admin = await login.json();
  // An impossible date must fail validation, without a real provider key/call.
  const invalid = await request.get(path.replace("2026-09-20", "2026-02-30"), {
    headers: { Authorization: `Bearer ${admin.idToken}` },
  });
  expect(invalid.status()).toBe(400);
});
