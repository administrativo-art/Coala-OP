import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

for (const endpoint of ["stone-agenda", "stone-anticipations", "agent"]) {
test(`${endpoint} denies anonymous and restricted users before contacting Stone`, async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Auth emulator required");
  const path = `/api/financial/${endpoint}?stoneCode=123456789&referenceDate=2026-09-20`;
  const invoke = (token?: string, date = "2026-09-20") => endpoint === "agent"
    ? request.post("/api/financial/agent", { headers: token ? { Authorization: `Bearer ${token}` } : {},
      data: { intent: "review_anticipations", kioskId: "agent-e2e-unmapped", stoneCode: "123456789", referenceDate: date } })
    : request.get(path.replace("2026-09-20", date), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect((await invoke()).status()).toBe(401);
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
  const denied = await invoke(user.idToken);
  expect(denied.status()).toBe(403);

  const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
  });
  expect(login.ok()).toBeTruthy();
  const admin = await login.json();
  // An impossible date must fail validation, without a real provider key/call.
  const invalid = await invoke(admin.idToken, "2026-02-30");
  expect(invalid.status()).toBe(400);
  if (endpoint === "agent") {
    // The safe lack of mapping must be actionable, not an invented zero or provider call.
    const unmapped = await invoke(admin.idToken);
    expect(unmapped.status()).toBe(422);
    expect(JSON.stringify(await unmapped.json())).toContain("FINANCIAL_AGENT_MAPPING_REQUIRED");
    const financialDb = getFirestore(app, "coala-financeiro");
    await financialDb.collection("stoneMerchantMappings").doc("agent-e2e-map-a").set({
      workspaceId: "coala", kioskId: "agent-e2e-unmapped", accountId: "agent-e2e-account",
      stoneCodes: ["123456789"], terminalIds: ["partitioned-terminal"],
      status: "active", validFrom: "2026-01-01", validTo: null,
    });
    try {
      const partitioned = await invoke(admin.idToken);
      expect(partitioned.status()).toBe(422);
      expect(JSON.stringify(await partitioned.json())).toContain("FINANCIAL_AGENT_MAPPING_AMBIGUOUS");
    } finally {
      await financialDb.collection("stoneMerchantMappings").doc("agent-e2e-map-a").delete();
    }
  }
});
}
