import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";
import { financialDateKey } from "../../../src/features/financial/lib/financial-dates";

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

test("orçamento agrupa despesas, impede sobreposição e protege a criação", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Emulador Auth obrigatório.");
  const app = getApps().find((item) => item.name === "financial-budget-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "financial-budget-e2e");
  const main = getFirestore(app, "coala");
  const db = getFirestore(app, "coala-financeiro");
  const month = "2026-10";
  const account = db.collection("accounts").doc("budget-e2e-inputs");
  const outside = db.collection("accounts").doc("budget-e2e-outside");
  const expense = db.collection("expenses").doc("budget-e2e-expense");
  const restrictedSignUp = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { data: { returnSecureToken: true } });
  const restricted = await restrictedSignUp.json();
  const restrictedUser = main.collection("users").doc(restricted.localId);
  const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
  });
  const { idToken: token } = await login.json();
  const body = { name: "Insumos E2E", accountPlanIds: [account.id], competenceMonth: month, budgetedAmountCents: 1200000 };
  const postBudget = (idToken: string, data: unknown) => request.post("/api/financial/budgets", { headers: { Authorization: `Bearer ${idToken}` }, data });
  let createdId: string | null = null;
  let projectId: string | null = null;
  try {
    await Promise.all([
      restrictedUser.set({ isActive: true, assignedKioskIds: [], profileCompliance: { status: "complete", policyVersion: 1 } }),
      account.set({ name: "Insumos E2E", active: true, isGroup: false }),
      outside.set({ name: "Fora E2E", active: true, isGroup: false }),
      expense.set({ status: "pending", provisionType: "actual", competenceMonth: month, competenceDate: "2026-10-05",
        totalValue: 300, hasAccountAllocations: true,
        accountAllocations: [{ accountPlanId: account.id, amount: 100 }, { accountPlanId: outside.id, amount: 200 }] }),
    ]);
    expect((await postBudget(restricted.idToken, body)).status()).toBe(403);
    expect((await postBudget(token, { ...body, accountPlanIds: ["unknown"] })).status()).toBe(400);
    const created = await postBudget(token, body);
    expect(created.status()).toBe(201);
    createdId = (await created.json()).id;
    expect((await postBudget(token, body)).status()).toBe(400);
    const response = await request.get(`/api/financial/budgets?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status()).toBe(200);
    const { budgets } = await response.json();
    const budget = budgets.find((item: { id: string }) => item.id === createdId);
    expect(budget.consumedAmountCents).toBe(10000);
    expect(budget.balanceAmountCents).toBe(1190000);
    await expense.update({ status: "paid" });
    const afterPayment = await request.get(`/api/financial/budgets/${createdId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await afterPayment.json()).budget.consumedAmountCents).toBe(10000);
    const projectCreated = await request.post("/api/financial/budget-projects", { headers: { Authorization: `Bearer ${token}` },
      data: { name: "Reforma E2E", accountPlanIds: [account.id], startMonth: "2026-10", endMonth: "2026-12", budgetedAmountCents: 500000 } });
    expect(projectCreated.status()).toBe(201);
    projectId = (await projectCreated.json()).id;
    const candidates = await request.get(`/api/financial/budget-projects/${projectId}/candidates?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await candidates.json()).expenses.some((item: { id: string }) => item.id === expense.id)).toBe(true);
    const linkPath = `/api/financial/budget-projects/${projectId}/expenses`;
    expect((await request.post(linkPath, { headers: { Authorization: `Bearer ${token}` }, data: { expenseId: expense.id } })).status()).toBe(200);
    expect((await request.post(linkPath, { headers: { Authorization: `Bearer ${token}` }, data: { expenseId: expense.id } })).status()).toBe(400);
    const projectSummary = await request.get(`/api/financial/budget-projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await projectSummary.json()).project.consumedAmountCents).toBe(10000);
    expect((await request.delete(`${linkPath}?expenseId=${expense.id}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  } finally {
    await Promise.all([restrictedUser.delete(), account.delete(), outside.delete(), expense.delete()]);
    if (createdId) {
      await Promise.all([db.collection("financialBudgets").doc(createdId).delete(),
        db.collection("financialBudgetAccountClaims").doc(`${month}_${account.id}`).delete()]);
    }
    if (projectId) {
      const events = await db.collection("financialBudgetProjectEvents").where("projectId", "==", projectId).limit(20).get();
      await Promise.all([...events.docs.map((doc) => doc.ref.delete()),
        db.collection("financialBudgetProjectExpenseClaims").doc(expense.id).delete(),
        db.collection("financialBudgetProjects").doc(projectId).delete()]);
    }
  }
});

test("prévia de consumo usa preço efetivo e estoque; geração mensal é idempotente", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const app = getApps().find((item) => item.name === "financial-budget-price-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "financial-budget-price-e2e");
  const main = getFirestore(app, "coala");
  const db = getFirestore(app, "coala-financeiro");
  const currentMonth = financialDateKey(new Date())!.slice(0, 7);
  const targetMonth = shiftMonth(currentMonth, 1);
  const account = db.collection("accounts").doc("budget-e2e-stock-account");
  const base = main.collection("baseProducts").doc("budget-e2e-stock-base");
  const product = main.collection("products").doc("budget-e2e-stock-product");
  const lot = main.collection("lots").doc("budget-e2e-stock-lot");
  const price = main.collection("effective_cost_history").doc("budget-e2e-stock-price");
  const reports = [shiftMonth(currentMonth, -1), shiftMonth(currentMonth, -2)]
    .map((month) => main.collection("consumptionReports").doc(`budget-e2e-stock-${month}`));
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error("Emulador Auth obrigatório.");
  const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
  });
  const { idToken: token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };
  const rule = { name: "Insumos por consumo E2E", accountPlanIds: [account.id], mode: "consumption_price",
    fixedAmountCents: null, averageMonths: 2, startMonth: targetMonth, baseProductIds: [base.id],
    stockKioskId: "matriz", closingStockDays: 7 };
  let ruleId: string | null = null;
  try {
    await Promise.all([
      account.set({ name: "Insumos E2E", active: true, isGroup: false }),
      base.set({ name: "Insumo E2E", unit: "un", category: "Unidade", stockLevels: {} }),
      product.set({ baseProductId: base.id, packageSize: 1, unit: "un", category: "Unidade" }),
      lot.set({ kioskId: "matriz", productId: product.id, quantity: 20, reservedQuantity: 0, expiryDate: null }),
      price.set({ workspaceId: "coala", baseItemId: base.id, quantity: 10, unitCost: 4,
        occurredAt: new Date().toISOString() }),
      ...reports.map((ref, index) => {
        const [year, month] = shiftMonth(currentMonth, -index - 1).split("-").map(Number);
        return ref.set({ year, month, kioskId: "e2e-unit", status: "completed", results: [
          { baseProductId: base.id, productName: "Insumo E2E", consumedQuantity: 30 },
        ] });
      }),
    ]);
    const reportCheck = await main.collection("consumptionReports")
      .where("year", "==", Number(shiftMonth(currentMonth, -1).slice(0, 4)))
      .where("month", "==", Number(shiftMonth(currentMonth, -1).slice(5, 7))).get();
    expect(reportCheck.docs.some((doc) => doc.id === reports[0].id)).toBe(true);
    const previewResponse = await request.post("/api/financial/budget-rules/preview", { headers, data: { rule, month: targetMonth } });
    expect(previewResponse.status(), await previewResponse.text()).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.amountCents).toBeGreaterThan(0);
    expect(preview.snapshot.referenceMonths).toEqual([shiftMonth(currentMonth, -1), shiftMonth(currentMonth, -2)]);
    expect(preview.snapshot.inputEstimates[0].forecastQuantity).toBe(30);
    expect(preview.snapshot.inputEstimates[0].averagePriceCentsPerUnit).toBe(400);
    const created = await request.post("/api/financial/budget-rules", { headers, data: rule });
    expect(created.status()).toBe(201);
    ruleId = (await created.json()).id;
    const first = await request.post("/api/financial/budget-rules/generate", { headers, data: { month: targetMonth } });
    expect(first.status()).toBe(200);
    expect((await first.json()).results.find((item: { ruleId: string }) => item.ruleId === ruleId).created).toBe(true);
    const second = await request.post("/api/financial/budget-rules/generate", { headers, data: { month: targetMonth } });
    expect(second.status()).toBe(200);
    expect((await second.json()).results.find((item: { ruleId: string }) => item.ruleId === ruleId).created).toBe(false);
    const summary = await request.get(`/api/financial/budgets?month=${targetMonth}`, { headers });
    expect((await summary.json()).budgets.find((item: { ruleId: string }) => item.ruleId === ruleId).budgetedAmountCents).toBe(preview.amountCents);
  } finally {
    await Promise.all([account.delete(), base.delete(), product.delete(), lot.delete(), price.delete(), ...reports.map((ref) => ref.delete())]);
    if (ruleId) await Promise.all([
      db.collection("financialBudgetRules").doc(ruleId).delete(),
      db.collection("financialBudgetRuleAccountClaims").doc(account.id).delete(),
      db.collection("financialBudgets").doc(`${ruleId}_${targetMonth}`).delete(),
      db.collection("financialBudgetAccountClaims").doc(`${targetMonth}_${account.id}`).delete(),
    ]);
  }
});
