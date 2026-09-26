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

// API lifecycle coverage; do not run the browser suite without task-specific authorization.
test("projeto distribui desembolsos, substitui previsão por boleto e encerra apenas o restante", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Emulador Auth obrigatório.");
  const app = getApps().find((item) => item.name === "project-cash-e2e") ?? initializeApp({ projectId: "demo-coala-e2e" }, "project-cash-e2e");
  const db = getFirestore(app, "coala-financeiro");
  const first = shiftMonth(financialDateKey(new Date())!.slice(0, 7), 1);
  const last = shiftMonth(first, 1);
  const account = db.collection("accounts").doc("project-cash-e2e-material");
  const expense = db.collection("expenses").doc("project-cash-e2e-bill");
  const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
  });
  expect(login.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await login.json()).idToken}` };
  let id: string | undefined;
  try {
    await account.set({ name: "Material projeto E2E", active: true, isGroup: false });
    await expense.set({ status: "pending", competenceMonth: first, dueDate: `${shiftMonth(last, 1)}-10`, totalValue: 3000, accountId: account.id });
    const data = { name: "Reforma E2E", accountPlanIds: [account.id], periodMode: "date_range", startMonth: first, endMonth: last,
      startDate: `${first}-10`, endDate: `${last}-12`, budgetedAmountCents: 1000000, cashPlan: { mode: "custom", stages: [
        { id: "entry", name: "Entrada", startDate: `${first}-10`, endDate: `${first}-10`, amountCents: 400000 },
        { id: "delivery", name: "Entrega", startDate: `${last}-12`, endDate: `${last}-12`, amountCents: 600000 },
      ] } };
    expect((await request.post("/api/financial/budget-projects", { data })).status()).toBe(401);
    const created = await request.post("/api/financial/budget-projects", { headers, data });
    expect(created.status(), await created.text()).toBe(201); id = (await created.json()).id;
    const path = `/api/financial/budget-projects/${id}`;
    expect((await request.post(`${path}/expenses`, { headers, data: { expenseId: expense.id } })).status()).toBe(400);
    expect((await request.post(`${path}/expenses`, { headers, data: { expenseId: expense.id, stageId: "entry" } })).status()).toBe(200);
    const read = async () => { const response = await request.get(path, { headers }); expect(response.status()).toBe(200); return (await response.json()).project; };
    const projected = async () => {
      const response = await request.get(`/api/financial/budgets/cash-projections?from=${first}-01&to=${last}-12`, { headers });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).projectProjections.filter((row: { projectId: string }) => row.projectId === id)
        .reduce((sum: number, row: { amountCents: number }) => sum + row.amountCents, 0);
    };
    expect(await projected()).toBe(700000);
    const stage = (await read()).cashStages[0];
    expect((await request.post(`${path}/stages`, { headers, data: { stageId: "entry", evidence: stage.evidence,
      closed: true, confirmed: true, reason: "Entrada concluída sem compra adicional" } })).status()).toBe(200);
    expect(await projected()).toBe(600000);
    await expense.update({ status: "paid" });
    expect(await projected()).toBe(600000);
    expect((await read()).originalCashPlan.stages[0].amountCents).toBe(400000);
    expect((await expense.get()).get("dueDate")).toBe(`${shiftMonth(last, 1)}-10`);
  } finally {
    if (id) {
      for (const collection of ["financialBudgetProjectEvents", "financialBudgetRevisions"]) {
        const docs = await db.collection(collection).where("projectId", "==", id).limit(50).get();
        await Promise.all(docs.docs.map((doc) => doc.ref.delete()));
      }
      await db.collection("financialBudgetProjects").doc(id).delete();
    }
    await Promise.all([account.delete(), expense.delete(), db.collection("financialBudgetProjectExpenseClaims").doc(expense.id).delete()]);
  }
});

// Observation only until an explicitly authorized emulator E2E run validates this flow.
test("VT mantém boleto único, cobertura por pessoa e conversão confirmada das previsões", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Emulador Auth obrigatório.");
  const app = getApps().find((item) => item.name === "financial-vt-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "financial-vt-e2e");
  const main = getFirestore(app, "coala");
  const hr = getFirestore(app, "coala-rh");
  const db = getFirestore(app, "coala-financeiro");
  const month = "2026-10";
  const personId = "vt-e2e-person";
  const accountId = "vt-e2e-account";
  const centers = ["vt-e2e-a", "vt-e2e-b"];
  const actual = db.collection("expenses").doc("vt-e2e-bill");
  const forecast = db.collection("expenses").doc("vt-e2e-forecast");
  const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
  });
  expect(login.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await login.json()).idToken}` };
  const owned = [main.collection("users").doc(personId), hr.collection("employees").doc("vt-e2e-hr"),
    db.collection("accounts").doc(accountId), ...centers.map((id) => db.collection("resultCenters").doc(id)), actual, forecast];
  const budgetIds: string[] = [];
  let operationId: string | undefined;
  try {
    await Promise.all([
      owned[0].set({ username: "Pessoa VT E2E", isActive: true, admissionDate: "2025-01-01", hrEmployeeId: "vt-e2e-hr", unitIds: ["vt-e2e-unit"] }),
      owned[1].set({ name: "Pessoa VT E2E", status: "active", auth_uid: personId, source_user_id: personId }),
      owned[2].set({ name: "VT E2E", active: true, isGroup: false }),
      ...centers.map((id) => db.collection("resultCenters").doc(id).set({ name: id, active: true, unitIds: ["vt-e2e-unit"] })),
      actual.set({ competenceMonth: month, status: "pending", provisionType: "actual", totalValue: 403.2, accountId, resultCenter: "matriz",
        hasPersonAllocations: true, personAllocations: centers.map((resultCenter) => ({ employeeId: personId, employeeName: "Pessoa VT E2E", accountPlanId: accountId, resultCenter, amount: 201.6, analysisType: "employer_cost" })) }),
      forecast.set({ competenceMonth: month, status: "provisioned", provisionType: "forecast", totalValue: 420, accountId,
        employeeId: personId, provisionSeriesKey: `recurring:vale-transporte:${personId}`, dueDate: "2026-09-30" }),
    ]);
    for (const resultCenterId of centers) {
      const created = await request.post("/api/financial/budgets", { headers, data: { name: "VT E2E", competenceMonth: month,
        accountPlanIds: [accountId], resultCenterId, budgetedAmountCents: 21000,
        composition: [{ id: resultCenterId, employeeId: personId, accountPlanId: accountId, amountCents: 21000, expectedPurchaseDate: "2026-09-30", estimateSource: "manual" }] } });
      expect(created.status(), await created.text()).toBe(201);
      budgetIds.push((await created.json()).id);
    }
    const read = async (id: string) => {
      const response = await request.get(`/api/financial/budgets/${id}`, { headers });
      expect(response.status()).toBe(200);
      return (await response.json()).budget;
    };
    const budget = await read(budgetIds[0]);
    expect(budget.consumedAmountCents).toBe(20160);
    const coverage = { lineId: centers[0], state: "final", documentIds: budget.people[0].documentIds,
      documentFingerprints: budget.people[0].documentFingerprints, reason: "Compra conferida no teste", confirmed: true };
    await actual.update({ sourceDocumentSha256: "changed-support" });
    expect((await request.post(`/api/financial/budgets/${budgetIds[0]}/coverage`, { headers, data: coverage })).status()).toBe(400);
    coverage.documentFingerprints = (await read(budgetIds[0])).people[0].documentFingerprints;
    expect((await request.post(`/api/financial/budgets/${budgetIds[0]}/coverage`, { headers, data: coverage })).status()).toBe(200);
    const input = { month, reason: "Conversão revisada no E2E", mappings: [{ expenseId: forecast.id,
      destinations: budgetIds.map((budgetId, index) => ({ budgetId, lineId: centers[index] })) }] };
    const path = "/api/financial/budgets/forecast-conversion";
    const previewResponse = await request.post(path, { headers, data: { input } });
    expect(previewResponse.status(), await previewResponse.text()).toBe(200);
    const preview = await previewResponse.json();
    expect((await forecast.get()).get("status")).toBe("provisioned");
    const converted = await request.post(path, { headers, data: { input, confirmation: { confirmed: true, fingerprint: preview.fingerprint } } });
    expect(converted.status(), await converted.text()).toBe(200);
    operationId = (await converted.json()).operationId;
    expect((await forecast.get()).get("cancellationReason")).toBe("MIGRATED_TO_BUDGET");
    expect((await actual.get()).get("status")).toBe("pending");
    expect((await actual.get()).get("personAllocations")).toHaveLength(2);
    const cash = await request.get("/api/financial/budgets/cash-projections?from=2026-09-01&to=2026-09-30", { headers });
    expect(cash.status()).toBe(200);
    expect((await cash.json()).projections.filter((row: { budgetId: string }) => budgetIds.includes(row.budgetId))
      .reduce((sum: number, row: { amountCents: number }) => sum + row.amountCents, 0)).toBe(840);
  } finally {
    // Only deterministic documents owned by this emulator test; no production targets.
    for (const budgetId of budgetIds) {
      const revisions = await db.collection("financialBudgetRevisions").where("budgetId", "==", budgetId).limit(20).get();
      await Promise.all(revisions.docs.map((doc) => doc.ref.delete()));
      await db.collection("financialBudgets").doc(budgetId).delete();
    }
    if (operationId) await Promise.all([db.collection("financialBudgetConversions").doc(operationId).delete(), forecast.collection("events").doc(operationId).delete()]);
    await db.collection("financialBudgetAccountClaims").doc(`${month}_${accountId}`).delete();
    await Promise.all(owned.map((ref) => ref.delete()));
  }
});

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
    // Repeating the same link is idempotent; it must not duplicate the expense or consumption.
    expect((await request.post(linkPath, { headers: { Authorization: `Bearer ${token}` }, data: { expenseId: expense.id } })).status()).toBe(200);
    const projectSummary = await request.get(`/api/financial/budget-projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
    const linkedProject = (await projectSummary.json()).project;
    expect(linkedProject.expenseIds).toEqual([expense.id]);
    expect(linkedProject.consumedAmountCents).toBe(10000);
    const linkEvents = await db.collection("financialBudgetProjectEvents").where("projectId", "==", projectId).limit(20).get();
    expect(linkEvents.docs.filter((doc) => doc.get("action") === "link")).toHaveLength(1);
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
