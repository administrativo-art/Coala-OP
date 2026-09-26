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
const { convertForecastsToBudgets, listForecastConversionCandidates } = await import("../../src/features/financial/budgets/forecast-conversion.server.ts");
const { stopTerminatedEmployeeBudgetExpectations } = await import("../../src/features/financial/budgets/termination.server.ts");
const { budgetSummaryForViewer } = await import("../../src/features/financial/budgets/personnel-access.ts");
const { assertBudgetPermission } = await import("../../src/features/financial/budgets/access.server.ts");
const { createBudgetProject, getBudgetProjectSummary, updateBudgetProject, linkProjectExpense, unlinkProjectExpense, closeProjectStage } = await import("../../src/features/financial/budgets/service.server.ts");
const { getProjectCashProjections } = await import("../../src/features/financial/budgets/project-projections.server.ts");
const { assertBudgetCenterAccess } = await import("../../src/features/financial/budgets/references.server.ts");
const actor = { isDefaultAdmin: true, permissions: defaultAdminPermissions, decoded: { uid: "vtu-admin" }, userDoc: { id: "vtu-admin", unitAccessScope: "all" }, workspace_id: "coala" };
const month = "2026-10";
const part = (center, amount) => ({ id: center, employeeId: "vtu-person", employeeName: "Pessoa de teste", accountPlanId: "vtu-account", amount, resultCenter: center, analysisType: "employer_cost" });
const input = (center, name = "VT de teste") => ({ name, competenceMonth: month, accountPlanIds: ["vtu-account"], resultCenterId: center,
  budgetedAmountCents: 21000, composition: [{ id: `line-${center}`, employeeId: "vtu-person", accountPlanId: "vtu-account", amountCents: 21000, expectedPurchaseDate: "2026-09-30", estimateSource: "manual" }] });

test("Projetos: cronograma, vínculo exclusivo, encerramento concorrente, revisão e caixa", async (t) => {
  const accountId = "project-cash-material";
  const expense = db.collection("expenses").doc("project-cash-bill");
  await db.collection("accounts").doc(accountId).set({ name: "Material", active: true, isGroup: false });
  await expense.set({ status: "pending", competenceMonth: "2026-10", dueDate: "2027-01-10", totalValue: 3000, accountId });
  const input = { name: "Projeto de teste", accountPlanIds: [accountId], periodMode: "date_range", startMonth: "2026-10", endMonth: "2026-12",
    startDate: "2026-10-10", endDate: "2026-12-12", budgetedAmountCents: 1000000,
    cashPlan: { mode: "custom", stages: [
      { id: "entry", name: "Entrada", startDate: "2026-10-10", endDate: "2026-10-10", amountCents: 400000 },
      { id: "delivery", name: "Entrega", startDate: "2026-12-12", endDate: "2026-12-12", amountCents: 600000 },
    ] } };
  const created = await createBudgetProject(input, "test");
  const other = await createBudgetProject(input, "test");
  const read = () => getBudgetProjectSummary(created.id);
  const projected = async () => (await getProjectCashProjections({ from: "2026-01-01", to: "2099-12-31" }, [])).projectProjections
    .filter((row) => row.projectId === created.id).reduce((sum, row) => sum + row.amountCents, 0);
  try {
    await t.test("criação conserva referência e vínculo exige etapa válida", async () => {
      assert.equal((await read()).originalCashPlan.stages.length, 2);
      await assert.rejects(linkProjectExpense(created.id, expense.id, "test"));
      await assert.rejects(linkProjectExpense(created.id, expense.id, "test", "missing"));
      await linkProjectExpense(created.id, expense.id, "test", "entry");
      await linkProjectExpense(created.id, expense.id, "test", "entry");
      assert.equal((await read()).expenseIds.length, 1);
      await assert.rejects(linkProjectExpense(other.id, expense.id, "test", "entry"));
      assert.equal(await projected(), 700000);
    });
    await t.test("encerramento exige leitura atual e não modifica a despesa", async () => {
      const stage = (await read()).cashStages[0];
      const closure = { stageId: stage.id, closed: true, reason: "Etapa conferida", confirmed: true, evidence: stage.evidence };
      await expense.update({ totalValue: 2000 });
      await assert.rejects(closeProjectStage(created.id, closure, "test"));
      await closeProjectStage(created.id, { ...closure, evidence: (await read()).cashStages[0].evidence }, "test");
      assert.equal(await projected(), 600000);
      await expense.update({ status: "paid" });
      assert.equal((await read()).cashStages[0].closed, true);
      assert.equal(await projected(), 600000);
      await linkProjectExpense(created.id, expense.id, "test", "entry");
      assert.equal((await read()).cashStages[0].closed, true);
      await updateBudgetProject(created.id, { cashPlan: input.cashPlan, reason: "Reenvio sem mudança" }, "test");
      assert.equal((await read()).cashStages[0].closed, true);
      await updateBudgetProject(created.id, { budgetedAmountCents: 1100000, cashPlan: { mode: "custom", stages: input.cashPlan.stages.map((s) => s.id === "delivery" ? { ...s, amountCents: 700000 } : s) }, reason: "Ajustar somente entrega" }, "test");
      assert.equal((await read()).cashStages[0].closed, true);
      assert.equal((await read()).cashStages[0].requiresReview, false);
      await updateBudgetProject(created.id, { budgetedAmountCents: 1000000, cashPlan: input.cashPlan, reason: "Restaurar entrega" }, "test");
      assert.equal((await read()).cashStages[0].closed, true);
      const delivery = (await read()).cashStages[1];
      await closeProjectStage(created.id, { stageId: "delivery", closed: true, evidence: delivery.evidence, reason: "Etapa dispensada sem despesas", confirmed: true }, "test");
      await assert.rejects(updateBudgetProject(created.id, { cashPlan: { mode: "custom", stages: [{ ...input.cashPlan.stages[0], amountCents: 1000000 }] }, reason: "Remover etapa dispensada" }, "test"));
      await closeProjectStage(created.id, { stageId: "delivery", closed: false, evidence: delivery.evidence, reason: "Restaurar planejamento", confirmed: true }, "test");
      assert.equal((await expense.get()).get("competenceMonth"), "2026-10");
      assert.equal((await expense.get()).get("dueDate"), "2027-01-10");
    });
    await t.test("alterar valores invalida encerramento, revisão preserva baseline", async () => {
      await expense.update({ totalValue: 1000 });
      assert.equal((await read()).cashStages[0].requiresReview, true);
      assert.equal(await projected(), 900000);
      await assert.rejects(updateBudgetProject(created.id, { budgetedAmountCents: 1100000, reason: "Novo orçamento" }, "test"));
      await updateBudgetProject(created.id, { budgetedAmountCents: 1100000, reason: "Revisão do cronograma", cashPlan: { mode: "custom", stages: input.cashPlan.stages.map((s) => s.id === "delivery" ? { ...s, amountCents: 700000 } : s) } }, "test");
      assert.equal((await read()).originalCashPlan.stages[1].amountCents, 600000);
      assert.equal((await read()).cashPlan.stages[1].amountCents, 700000);
      await assert.rejects(updateBudgetProject(created.id, { cashPlan: { mode: "uniform", stages: [] }, reason: "Troca inválida com vínculos" }, "test"));
    });
    await t.test("documento ausente suspende cálculo, desvincular restaura; escopo global protegido", async () => {
      await expense.delete(); // Owned emulator fixture only.
      assert.equal(await projected(), 0);
      assert.ok((await read()).issues.some((issue) => issue.includes("não encontrad")));
      await unlinkProjectExpense(created.id, expense.id, "test");
      assert.equal(await projected(), 1100000);
      const restricted = { ...actor, isDefaultAdmin: false, userDoc: { id: "project-restricted", unitIds: ["one-unit"] } };
      assert.throws(() => assertBudgetCenterAccess(restricted));
      const collision = await getProjectCashProjections({ from: "2026-01-01", to: "2099-12-31" }, [accountId]);
      assert.equal(collision.projectProjections.filter((row) => row.projectId === created.id).length, 0);
      assert.ok(collision.projectIssues.some((issue) => issue.includes("sobreposição")));
    });
  } finally {
    await Promise.all([created.id, other.id].map((id) => updateBudgetProject(id, { active: false }, "test")));
  }
});

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

  await t.test("VT rateado resolve nomes legados e conserva valores por centro em transação", async () => {
    const splitRef = db.collection("expenses").doc("vtu-split-forecast");
    const splitObligation = db.collection("financialObligations").doc("vtu-split-obligation");
    const billBefore = (await actualRef.get()).data();
    await splitObligation.set({ sourceId: splitRef.id, status: "OPEN", summary: { forecastAmountCents: 42000 } });
    const portions = [part("Centro a", 210), part("Centro b", 210)];
    await splitRef.set({ competenceMonth: month, provisionCompetence: month, dueDate: "2026-09-30",
      accountId: "vtu-account", employeeId: "vtu-person", provisionSeriesKey: "recurring:vale-transporte:vtu-person",
      provisionType: "forecast", status: "provisioned", totalValue: 420, isApportioned: true,
      hasPersonAllocations: true, personAllocations: portions, obligationId: splitObligation.id,
      apportionments: ["Centro a", "Centro b"].map((resultCenter) => ({ resultCenter, percentage: 50 })) });
    const request = { ...conversion, mappings: [{ ...conversion.mappings[0], expenseId: splitRef.id }] };
    const candidates = await listForecastConversionCandidates(month, actor);
    assert.equal(candidates.find((row) => row.id === splitRef.id).blocked, null);
    const preview = await convertForecastsToBudgets(request, actor);
    assert.deepEqual(preview.preview.rows[0].centerAmounts, ["vtu-a", "vtu-b"].map((resultCenterId) => ({ resultCenterId, amountCents: 21000 })));
    assert.equal((await splitRef.get()).get("status"), "provisioned");
    const budgetA = db.collection("financialBudgets").doc(a.id);
    const budgetB = db.collection("financialBudgets").doc(b.id);
    const originalA = (await budgetA.get()).get("composition");
    const originalB = (await budgetB.get()).get("composition");
    await budgetA.update({ composition: originalA.map((line) => ({ ...line, amountCents: 20000 })) });
    await budgetB.update({ composition: originalB.map((line) => ({ ...line, amountCents: 22000 })) });
    await assert.rejects(convertForecastsToBudgets(request, actor), /cada centro/);
    assert.equal((await splitRef.get()).get("status"), "provisioned");
    await budgetA.update({ composition: originalA });
    await budgetB.update({ composition: originalB });
    await splitRef.update({ personAllocations: [part("Centro a", 209), part("Centro b", 211)] });
    await assert.rejects(convertForecastsToBudgets(request, actor), /incompatíveis/);
    await splitRef.update({ personAllocations: portions });
    const ambiguous = db.collection("resultCenters").doc("vtu-duplicate-name");
    await ambiguous.set({ name: "Centro a", active: true });
    await assert.rejects(convertForecastsToBudgets(request, actor));
    await ambiguous.delete(); // Owned emulator fixture only.
    await assert.rejects(convertForecastsToBudgets(request, actor, { fingerprint: preview.fingerprint, confirmed: true }), /prévia mudou/);
    const current = await convertForecastsToBudgets(request, actor);
    const result = await convertForecastsToBudgets(request, actor, { fingerprint: current.fingerprint, confirmed: true });
    assert.equal(result.converted, true);
    assert.equal((await splitRef.get()).get("status"), "cancelled");
    assert.equal((await splitObligation.get()).get("status"), "CANCELLED");
    assert.equal((await splitRef.get()).get("personAllocations").length, 2);
    assert.deepEqual((await actualRef.get()).data(), billBefore);
    assert.equal((await convertForecastsToBudgets(request, actor, { fingerprint: current.fingerprint, confirmed: true })).alreadyConverted, true);
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
