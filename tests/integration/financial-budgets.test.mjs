import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-coala-repository");
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { dbAdmin: main } = await import("../../src/lib/firebase-admin.ts");
const { hrDbAdmin: hr } = await import("../../src/lib/firebase-rh-admin.ts");
const { defaultAdminPermissions, defaultGuestPermissions } = await import("../../src/types/index.ts");
const { createBudget, createBudgetRule, generateBudgetMonth, getBudgetSummary, confirmBudgetCoverage, listBudgetSummaries } = await import("../../src/features/financial/budgets/service.server.ts");
const { getBudgetCashProjections, getBudgetPlanningComparisons } = await import("../../src/features/financial/budgets/projections.server.ts");
const { convertForecastsToBudgets } = await import("../../src/features/financial/budgets/forecast-conversion.server.ts");
const { stopTerminatedEmployeeBudgetExpectations } = await import("../../src/features/financial/budgets/termination.server.ts");
const { budgetSummaryForViewer } = await import("../../src/features/financial/budgets/personnel-access.ts");
const { assertBudgetPermission } = await import("../../src/features/financial/budgets/access.server.ts");
const actor = { isDefaultAdmin: true, permissions: defaultAdminPermissions, decoded: { uid: "vtu-admin" }, userDoc: { id: "vtu-admin", unitAccessScope: "all" }, workspace_id: "coala" };
const month = "2026-10";
const part = (center, amount) => ({ id: center, employeeId: "vtu-person", employeeName: "Pessoa de teste", accountPlanId: "vtu-account", amount, resultCenter: center, analysisType: "employer_cost" });
const input = (center, name = "VT de teste") => ({ name, competenceMonth: month, accountPlanIds: ["vtu-account"], resultCenterId: center,
  budgetedAmountCents: 21000, composition: [{ id: `line-${center}`, employeeId: "vtu-person", accountPlanId: "vtu-account", amountCents: 21000, expectedPurchaseDate: "2026-09-30", estimateSource: "manual" }] });

test("VT: persistência, claims concorrentes, cobertura, conversão atômica e caixa/DRE", async (t) => {
  await Promise.all([
    main.collection("users").doc("vtu-person").set({ isActive: true, username: "Pessoa de teste", hrEmployeeId: "vtu-rh-legacy", admissionDate: "2025-01-01", unitIds: ["vtu-unit-a", "vtu-unit-b"] }),
    hr.collection("employees").doc("vtu-rh-legacy").set({ status: "active", name: "Pessoa de teste", auth_uid: "vtu-person", source_user_id: "vtu-person" }),
    db.collection("accounts").doc("vtu-account").set({ active: true, name: "VT", isGroup: false }),
    ...["a", "b", "admin"].map((key) => db.collection("resultCenters").doc(`vtu-${key}`).set({ name: `Centro ${key}`, active: true, unitIds: [`vtu-unit-${key}`] })),
  ]);
  const [a, b] = await Promise.all([createBudget(input("vtu-a"), actor.decoded.uid, { actor }), createBudget(input("vtu-b"), actor.decoded.uid, { actor })]);
  await assert.rejects(createBudget({ name: "Sobreposição global", competenceMonth: month, accountPlanIds: ["vtu-account"], budgetedAmountCents: 100 }, actor.decoded.uid, { actor }));

  await t.test("global/local competem pelo mesmo claim, sem dupla criação", async () => {
    await db.collection("accounts").doc("vtu-race").set({ active: true, name: "Race", isGroup: false });
    const basic = { name: "Orçamento concorrente", competenceMonth: month, accountPlanIds: ["vtu-race"], budgetedAmountCents: 100 };
    const race = await Promise.allSettled([createBudget(basic, "test", { actor }), createBudget({ ...basic, resultCenterId: "vtu-a" }, "test", { actor })]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  });

  const actualRef = db.collection("expenses").doc("vtu-bill");
  await actualRef.set({ competenceMonth: month, competenceDate: "2026-10-01", dueDate: "2026-10-08", accountId: "vtu-account", status: "pending", provisionType: "actual",
    totalValue: 403.2, resultCenter: "vtu-admin", hasPersonAllocations: true, personAllocations: [part("vtu-a", 201.6), part("vtu-b", 201.6)] });
  await t.test("boleto único consome por centro; confirmação exige documento observado", async () => {
    const summary = await getBudgetSummary(a.id, actor);
    assert.equal(summary.consumedAmountCents, 20160);
    assert.equal(summary.people[0].residualAmountCents, 840);
    const coverage = { lineId: summary.people[0].id, state: "final", documentIds: summary.people[0].documentIds,
      documentFingerprints: summary.people[0].documentFingerprints, reason: "Compra conferida", confirmed: true };
    await actualRef.update({ sourceDocumentSha256: "new-support" });
    await assert.rejects(confirmBudgetCoverage(a.id, coverage, actor.decoded.uid, actor));
    const refreshed = await getBudgetSummary(a.id, actor);
    await confirmBudgetCoverage(a.id, { ...coverage, documentFingerprints: refreshed.people[0].documentFingerprints }, actor.decoded.uid, actor);
    await actualRef.update({ status: "paid" });
    assert.equal((await getBudgetSummary(a.id, actor)).residualAmountCents, 0);
    await actualRef.update({ status: "pending" });
    assert.equal((await getBudgetSummary(a.id, actor)).residualAmountCents, 0);
  });

  const sourceRef = db.collection("expenses").doc("vtu-forecast");
  const obligationRef = db.collection("financialObligations").doc("vtu-obligation");
  await obligationRef.set({ sourceId: sourceRef.id, status: "OPEN", reconciliationStatus: "NOT_FOUND", summary: { forecastAmountCents: 42000, actualAmountCents: null, paymentEvidenceStatus: "NONE" } });
  await sourceRef.set({ competenceMonth: month, provisionCompetence: month, competenceDate: "2026-10-01", dueDate: "2026-09-30",
    accountId: "vtu-account", employeeId: "vtu-person", provisionSeriesKey: "recurring:vale-transporte:vtu-person", provisionType: "forecast", status: "provisioned", totalValue: 420, resultCenter: "vtu-admin", obligationId: obligationRef.id });
  const conversion = { month, reason: "Transição sintética para envelope", mappings: [{ expenseId: sourceRef.id,
    destinations: [{ budgetId: a.id, lineId: "line-vtu-a" }, { budgetId: b.id, lineId: "line-vtu-b" }] }] };
  await t.test("coexistência suspende projeção nova; prévia e conversão preservam boleto e histórico", async () => {
    const before = await getBudgetCashProjections(actor, { from: "2026-09-01", to: "2026-09-30" });
    assert.equal(before.conflictCount, 2);
    assert.equal(before.projections.length, 0);
    await obligationRef.update({ reconciliationStatus: "MATCHED" });
    await assert.rejects(convertForecastsToBudgets(conversion, actor));
    await obligationRef.update({ reconciliationStatus: "NOT_FOUND" });
    const shared = db.collection("expenses").doc("vtu-shared-obligation");
    await shared.set({ obligationId: obligationRef.id });
    await assert.rejects(convertForecastsToBudgets(conversion, actor));
    await shared.delete(); // Synthetic fixture, no real expense.
    const stale = await convertForecastsToBudgets(conversion, actor);
    assert.equal((await sourceRef.get()).get("status"), "provisioned");
    await sourceRef.update({ notes: "Mudança concorrente" });
    await assert.rejects(convertForecastsToBudgets(conversion, actor, { fingerprint: stale.fingerprint, confirmed: true }));
    const preview = await convertForecastsToBudgets(conversion, actor);
    assert.equal(preview.preview.forecastAmountCents, 42000);
    assert.equal(preview.preview.residualAfterCents, 840);
    const bankRequest = db.collection("bankPaymentRequests").doc("vtu-bank-block");
    await bankRequest.set({ expenseId: sourceRef.id, status: "awaiting_bank_approval" });
    await assert.rejects(convertForecastsToBudgets(conversion, actor, { fingerprint: preview.fingerprint, confirmed: true }));
    assert.equal((await sourceRef.get()).get("status"), "provisioned");
    await bankRequest.delete(); // Synthetic emulator fixture only.
    const result = await convertForecastsToBudgets(conversion, actor, { fingerprint: preview.fingerprint, confirmed: true });
    assert.equal(result.converted, true);
    assert.equal((await sourceRef.get()).get("status"), "cancelled");
    assert.equal((await sourceRef.get()).get("cancellationReason"), "MIGRATED_TO_BUDGET");
    assert.equal((await obligationRef.get()).get("status"), "CANCELLED");
    assert.notEqual((await obligationRef.get()).get("summary.reconciliationStatus"), "MATCHED");
    assert.equal((await actualRef.get()).get("status"), "pending");
    assert.equal((await actualRef.get()).get("totalValue"), 403.2);
    assert.equal((await convertForecastsToBudgets(conversion, actor, { fingerprint: preview.fingerprint, confirmed: true })).alreadyConverted, true);
    const after = await getBudgetCashProjections(actor, { from: "2026-09-01", to: "2026-09-30" });
    assert.equal(after.projections.reduce((sum, row) => sum + row.amountCents, 0), 840);
    assert.equal(after.projections[0].competenceMonth, "2026-10");
    assert.equal(after.projections[0].date, "2026-09-30");
    assert.ok(!JSON.stringify(after).includes("vtu-person"));
    const comparison = await getBudgetPlanningComparisons({ periods: [month], kioskIds: ["vtu-unit-a", "vtu-unit-b"],
      expenses: [{ id: actualRef.id, ...(await actualRef.get()).data() }], canViewPersonnel: false });
    assert.equal(comparison.reduce((sum, row) => sum + row.committedAmountCents, 0), 40320);
    assert.equal(comparison.reduce((sum, row) => sum + row.budgetedAmountCents, 0), 42000);
  });

  await t.test("permissões e privacidade não dependem dos botões", async () => {
    const restricted = { ...actor, isDefaultAdmin: false, permissions: defaultGuestPermissions, userDoc: { id: "restricted", unitIds: ["vtu-unit-a"] } };
    assert.throws(() => assertBudgetPermission(restricted, "manage"));
    await assert.rejects(convertForecastsToBudgets(conversion, restricted));
    await assert.rejects(listBudgetSummaries(month, "vtu-b", restricted));
    const redacted = budgetSummaryForViewer(await getBudgetSummary(a.id, actor), false);
    assert.ok(!JSON.stringify(redacted).includes("vtu-person"));
    assert.equal(redacted.hasComposition, true);
    assert.equal(redacted.people, undefined);
  });

  await t.test("desligamento encerra expectativas futuras sem cancelar boleto compartilhado", async () => {
    const params = { employeeId: "vtu-person", terminationDate: "2026-09-29", terminationProcessId: "vtu-termination", actorId: actor.decoded.uid };
    assert.equal((await stopTerminatedEmployeeBudgetExpectations(params)).stoppedCount, 2);
    assert.equal((await stopTerminatedEmployeeBudgetExpectations(params)).stoppedCount, 0);
    assert.equal((await getBudgetSummary(b.id, actor)).residualAmountCents, 0);
    assert.equal((await actualRef.get()).get("status"), "pending");
    assert.equal((await actualRef.get()).get("personAllocations").length, 2);
  });

  await t.test("geração antecipada é idempotente e preserva snapshot", async () => {
    const rule = await createBudgetRule({ name: "VT fixo futuro", accountPlanIds: ["vtu-account"], resultCenterId: "vtu-a", mode: "fixed", fixedAmountCents: 21000,
      averageMonths: 3, startMonth: "2026-11", endMonth: "2026-12", generationLeadMonths: 1,
      composition: [{ id: "future-line", employeeId: "vtu-person", accountPlanId: "vtu-account", amountCents: 21000, purchaseDay: 31, purchaseMonthOffset: -1 }] }, actor.decoded.uid, actor);
    const first = await generateBudgetMonth("2026-11", actor.decoded.uid, { actor, resultCenterId: "vtu-a" });
    assert.equal(first.find((item) => item.ruleId === rule.id).created, true);
    const second = await generateBudgetMonth("2026-11", actor.decoded.uid, { actor, resultCenterId: "vtu-a" });
    assert.equal(second.find((item) => item.ruleId === rule.id).created, false);
    assert.equal((await getBudgetSummary(`${rule.id}_2026-11`, actor)).composition[0].expectedPurchaseDate, "2026-10-31");
  });
});
