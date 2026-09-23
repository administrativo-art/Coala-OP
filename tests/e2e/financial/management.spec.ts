import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

test("management analysis and routines enforce scope, revision, idempotence and human acknowledgement", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Auth emulator required");
  const app = getApps().find(a => a.name === "financial-management-e2e") ?? initializeApp({ projectId: "demo-coala-e2e" }, "financial-management-e2e");
  const main = getFirestore(app, "coala"); const db = getFirestore(app, "coala-financeiro");
  const month = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);
  const unit = main.collection("kiosks").doc("management-e2e-unit");
  const account = db.collection("bankAccounts").doc("management-e2e-account");
  const mapping = db.collection("stoneMerchantMappings").doc("management-e2e-mapping");
  const movement = db.collection("transactions").doc("management-e2e-transaction");
  const paidMovement = db.collection("transactions").doc("management-e2e-payment");
  const expense = db.collection("expenses").doc("management-e2e-expense");
  const input = { kioskId: unit.id, mappingId: mapping.id, stoneCode: "9876501234", month, includeStone: false };
  const post = (path: string, token?: string, data: unknown = input) => request.post(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, data });
  const analysis = "/api/financial/management-analysis"; const routines = "/api/financial/analysis-routines";
  expect((await post(analysis)).status()).toBe(401);
  expect((await post(routines)).status()).toBe(401);
  expect((await post(`${routines}/scheduler`)).status()).toBe(401);
  const signup = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { data: { returnSecureToken: true } });
  const restricted = await signup.json(); const user = main.collection("users").doc(restricted.localId);
  let routineId: string | null = null;
  try {
    await user.set({ isActive: true, assignedKioskIds: [], profileCompliance: { status: "complete", policyVersion: 1 } });
    expect((await post(analysis, restricted.idToken)).status()).toBe(403);
    expect((await post(routines, restricted.idToken, { action: "run", id: "forbidden" })).status()).toBe(403);
    const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true } });
    const { idToken: token } = await login.json();
    expect((await post(analysis, token, { ...input, workspaceId: "foreign" })).status()).toBe(400);
    expect((await post(analysis, token)).status()).toBe(422);
    await unit.set({ workspaceId: "coala", name: "Management E2E" });
    await account.set({ workspaceId: "coala", name: "Management E2E account" });
    await mapping.set({ workspaceId: "coala", kioskId: unit.id, accountId: account.id, stoneCodes: [input.stoneCode], terminalIds: [], status: "active", validFrom: "2020-01-01", validTo: null });
    await movement.set({ accountId: account.id, direction: "in", amount: 10, date: Timestamp.fromDate(new Date(`${month}-01T12:00:00Z`)), importedFrom: "bank_statement" });
    await expense.set({ workspaceId: "coala", resultCenter: unit.id, bankAccountId: account.id,
      status: "partially_paid", totalValue: 10, dueDate: Timestamp.fromDate(new Date(`${month}-02T12:00:00Z`)),
      settlementSummary: { balanceAmountCents: 500 } });
    await paidMovement.set({ accountId: account.id, direction: "out", amount: 5,
      date: Timestamp.fromDate(new Date(`${month}-01T12:00:00Z`)), importedFrom: "bank_statement", expenseId: expense.id });
    const response = await post(analysis, token); expect(response.status()).toBe(200);
    const result = await response.json(); expect(result.cash.bankInCents).toBe(1000);
    expect(result.cash.bankOutCents).toBe(500); expect(result.cash.forecastOutCents).toBe(500);
    expect(result.cash.confirmedBalance).toBeNull(); expect(result.cash.projectedBalanceCents).toBeNull();
    expect(result.writesPerformed).toBe(false); expect(result.coverage).toBe("partial");
    expect(result.fees).toEqual([]);
    const save = { action: "save", request: input, enabled: false, cadence: "weekly", revision: 0 };
    const saved = await post(routines, token, save); expect(saved.status()).toBe(200);
    routineId = (await saved.json()).id;
    expect((await post(routines, token, save)).status()).toBe(409);
    const run = await post(routines, token, { action: "run", id: routineId }); expect(run.status()).toBe(200);
    const runData = await run.json(); expect(runData.executed).toBe(true);
    const again = await post(routines, token, { action: "run", id: routineId }); expect((await again.json()).executed).toBe(false);
    expect((await post(routines, token, { action: "acknowledge", id: routineId, runId: runData.runId, alertCode: "balance" })).status()).toBe(200);
    const data = (await db.collection("financialAnalysisRoutines").doc(routineId!).get()).data()!;
    expect(data.lastRun.alerts.find((alert: { code: string }) => alert.code === "balance").acknowledgedAt).toBeTruthy();
    expect((await movement.get()).data()?.amount).toBe(10);
    await account.update({ workspaceId: "foreign" });
    expect((await post(analysis, token)).status()).toBe(422);
  } finally {
    if (routineId) {
      const ref = db.collection("financialAnalysisRoutines").doc(routineId);
      for (const sub of ["audit", "runs"]) {
        const docs = await ref.collection(sub).limit(20).get(); await Promise.all(docs.docs.map(doc => doc.ref.delete()));
      }
      await ref.delete();
    }
    await Promise.all([user.delete(), unit.delete(), account.delete(), mapping.delete(), movement.delete(), paidMovement.delete(), expense.delete()]);
  }
});
