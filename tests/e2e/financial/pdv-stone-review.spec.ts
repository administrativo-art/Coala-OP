import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

test("PDV × Stone API enforces admin, bounded input, official unit mapping and stored filial", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Auth emulator required");
  const app = getApps().find(a => a.name === "pdv-stone-review-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "pdv-stone-review-e2e");
  const db = getFirestore(app, "coala");
  const financial = getFirestore(app, "coala-financeiro");
  const query = { kioskId: "pdv-review-e2e-unit", mappingId: "pdv-review-e2e-map", stoneCode: "9876543210123", referenceDate: "2026-09-20" };
  const post = (token?: string, data: unknown = query) => request.post("/api/financial/pdv-stone-review", {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, data,
  });
  expect((await post()).status()).toBe(401);
  const signup = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { data: { returnSecureToken: true } });
  expect(signup.ok()).toBeTruthy();
  const restricted = await signup.json();
  const restrictedRef = db.collection("users").doc(restricted.localId);
  const mappingRef = financial.collection("stoneMerchantMappings").doc(query.mappingId);
  const unitRef = db.collection("kiosks").doc(query.kioskId);
  const accountRef = financial.collection("bankAccounts").doc("pdv-review-e2e-account");
  try {
    await restrictedRef.set({ isActive: true, assignedKioskIds: [], profileCompliance: { status: "complete", policyVersion: 1 } });
    expect((await post(restricted.idToken)).status()).toBe(403);
    const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
      data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
    });
    expect(login.ok()).toBeTruthy();
    const admin = await login.json();
    for (const invalid of ["invalid-json", "x".repeat(2049), { ...query, referenceDate: "2026-02-30" }, { ...query, workspaceId: "foreign" }]) {
      const response = await post(admin.idToken, invalid);
      expect(response.status()).toBe(400);
      expect(JSON.stringify(await response.json())).not.toMatch(/stack|PDVLEGAL|Authorization|private_key/);
    }
    const missing = await post(admin.idToken);
    expect(missing.status()).toBe(422);
    expect(JSON.stringify(await missing.json())).toContain("FINANCIAL_AGENT_MAPPING_REQUIRED");
    const mapping = { workspaceId: "coala", kioskId: query.kioskId, accountId: accountRef.id,
      stoneCodes: [query.stoneCode], terminalIds: [], status: "active", validFrom: "2026-01-01", validTo: null };
    await mappingRef.set(mapping);
    await unitRef.set({ workspaceId: "coala", name: "Unit fixture" });
    await accountRef.set({ workspaceId: "coala", name: "Account fixture" });
    const noFilial = await post(admin.idToken);
    expect(noFilial.status()).toBe(422);
    expect(JSON.stringify(await noFilial.json())).toContain("SALES_REVIEW_FILIAL_REQUIRED");
    // Both failures are before any provider call. Do not inject live provider credentials.
    await unitRef.update({ workspaceId: "foreign", pdvFilialId: "123" });
    const foreign = await post(admin.idToken);
    expect(foreign.status()).toBe(422);
    expect(JSON.stringify(await foreign.json())).toContain("FINANCIAL_AGENT_REFERENCES_INVALID");
    await unitRef.update({ workspaceId: "coala" });
    await mappingRef.update({ terminalIds: ["partition"] });
    const partitioned = await post(admin.idToken);
    expect(partitioned.status()).toBe(422);
    expect(JSON.stringify(await partitioned.json())).toContain("FINANCIAL_AGENT_MAPPING_AMBIGUOUS");
    expect((await mappingRef.get()).data()).toEqual({ ...mapping, terminalIds: ["partition"] });
  } finally {
    await Promise.all([restrictedRef.delete(), mappingRef.delete(), unitRef.delete(), accountRef.delete()]);
  }
});
