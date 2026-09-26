import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectCashProjections, materializeProjectCashPlan, spreadProjectAmount, summarizeProjectCashPlan } from "../../src/features/financial/budgets/project-cash-plan";
import { createBudgetProjectSchema, projectCashPlanSchema } from "../../src/features/financial/budgets/schemas";
import { calculateProjectBudgetConsumption } from "../../src/features/financial/lib/budget-project-consumption";
import { cashForecastTotals, selectProjectCashProjections } from "../../src/features/financial/budgets/projection-view";
import { cashFlowPeriod, buildExpenseLifecycleData } from "../../src/features/financial/lib/cash-flow-analysis";
import { financialDateKey } from "../../src/features/financial/lib/financial-dates";
import type { FinancialBudgetProject } from "../../src/features/financial/budgets/types";
import type { BudgetExpense } from "../../src/features/financial/lib/budget-consumption";

const project: FinancialBudgetProject = { id: "test-project", name: "Reforma", accountPlanIds: ["material"],
  startMonth: "2026-10", endMonth: "2026-12", periodMode: "date_range", startDate: "2026-10-10", endDate: "2026-12-12",
  budgetedAmountCents: 1000000, active: true, expenseIds: [], createdBy: "test", createdAt: "", updatedAt: "" };
const range = { from: "2026-10-01", to: "2026-12-31", today: "2026-09-26" };
const sum = (rows: { amountCents: number }[]) => rows.reduce((total, row) => total + row.amountCents, 0);
const custom = () => ({ ...project, cashPlan: materializeProjectCashPlan(project, { mode: "custom", stages: [
  { id: "entry", name: "Entrada", startDate: "2026-10-10", endDate: "2026-10-10", amountCents: 400000 },
  { id: "work", name: "Execução", startDate: "2026-11-10", endDate: "2026-11-10", amountCents: 400000 },
  { id: "delivery", name: "Entrega", startDate: "2026-12-12", endDate: "2026-12-12", amountCents: 200000 },
] }) });
const bill: BudgetExpense & { dueDate: string } = { id: "bill", totalValue: 3000, status: "pending", competenceMonth: "2026-10", accountId: "material", dueDate: "2027-01-10" };

test("10/10 a 12/12: divisão inclusiva por 64 dias conserva R$ 10.000 e os três meses", () => {
  const cashPlan = materializeProjectCashPlan(project, { mode: "uniform", stages: [] });
  assert.deepEqual(cashPlan.stages.map((stage) => stage.amountCents), [343750, 468750, 187500]);
  const rows = buildProjectCashProjections({ ...project, cashPlan }, [], range).rows;
  assert.equal(rows.length, 64); assert.equal(sum(rows), 1000000);
  assert.equal(rows[0].date, "2026-10-10"); assert.equal(rows.at(-1)?.date, "2026-12-12");
});

test("fluxo permite consultar outubro a dezembro futuros com gráfico no mesmo intervalo", () => {
  const window = cashFlowPeriod("2026-12", 3);
  assert.equal(financialDateKey(window.periodStart), "2026-10-01");
  assert.equal(financialDateKey(window.periodEnd), "2026-12-31");
  assert.deepEqual(buildExpenseLifecycleData([], 3, window.referenceDate).map((point) => point.key), ["2026-10", "2026-11", "2026-12"]);
  assert.throws(() => cashFlowPeriod("2026-13", 3));
});

test("centavos, dia único e fevereiro bissexto não criam nem perdem dinheiro", () => {
  assert.equal(sum(spreadProjectAmount(1, "2028-02-01", "2028-02-29")), 1);
  assert.equal(spreadProjectAmount(101, "2026-10-10", "2026-10-10")[0].amountCents, 101);
  for (const amount of [0, 1, 99, 100, 100000000000]) assert.equal(sum(spreadProjectAmount(amount, "2026-10-10", "2026-12-12")), amount);
  assert.throws(() => spreadProjectAmount(100, "2026-12-12", "2026-10-10"));
  assert.throws(() => spreadProjectAmount(100, "2020-01-01", "2026-10-10"));
});

test("cronograma personalizado exige soma exata, datas válidas e etapas únicas", () => {
  const plan = custom().cashPlan!;
  assert.equal(plan.stages.length, 3);
  assert.throws(() => materializeProjectCashPlan(project, { ...plan, stages: plan.stages.slice(1) }));
  assert.throws(() => materializeProjectCashPlan(project, { ...plan, stages: [plan.stages[0], plan.stages[0]] }));
  assert.equal(projectCashPlanSchema.safeParse({ ...plan, stages: [{ ...plan.stages[0], startDate: "2026-02-30", endDate: "2026-02-30" }] }).success, false);
  assert.equal(createBudgetProjectSchema.safeParse({ ...project, cashPlan: plan }).success, true);
  assert.equal(createBudgetProjectSchema.safeParse({ ...project, startMonth: "2026-09" }).success, false);
  assert.equal(createBudgetProjectSchema.safeParse({ name: "Legado", accountPlanIds: ["a"], startMonth: "2026-10", endMonth: "2026-12", budgetedAmountCents: 0 }).success, true);
});

test("boleto substitui apenas sua etapa e mantém competência/vencimento; pagar não debita novamente", () => {
  const linked = { ...custom(), expenseIds: [bill.id], expenseStageIds: { [bill.id]: "entry" } };
  const original = JSON.stringify(linked.cashPlan);
  const stage = summarizeProjectCashPlan(linked, [bill]).stages[0];
  assert.equal(stage.committedAmountCents, 300000); assert.equal(stage.residualAmountCents, 100000);
  assert.equal(sum(buildProjectCashProjections(linked, [bill], range).rows), 700000);
  assert.equal(sum(buildProjectCashProjections(linked, [{ ...bill, status: "paid" }], range).rows), 700000);
  assert.equal(JSON.stringify(linked.cashPlan), original);
  assert.equal(bill.dueDate, "2027-01-10"); assert.equal(bill.competenceMonth, "2026-10");
  assert.deepEqual(cashForecastTotals([{ source: "expense", amount: 3000 }, { source: "project_residual", amount: 7000 }]), { payable: 3000, planning: 7000, scenario: 0 });
});

test("encerrar etapa retira só o restante, pagamento preserva conferência e edição de valor a invalida", () => {
  const linked = { ...custom(), expenseIds: [bill.id], expenseStageIds: { [bill.id]: "entry" } };
  const evidence = summarizeProjectCashPlan(linked, [bill]).stages[0].evidence;
  const closed = { ...linked, stageClosures: [{ stageId: "entry", evidence, reason: "Etapa concluída", actorUid: "test", closedAt: "2026-10-10" }] };
  assert.equal(sum(buildProjectCashProjections(closed, [bill], range).rows), 600000);
  assert.equal(summarizeProjectCashPlan(closed, [{ ...bill, status: "paid" }]).stages[0].closed, true);
  const changed = summarizeProjectCashPlan(closed, [{ ...bill, totalValue: 2000 }]);
  assert.equal(changed.stages[0].requiresReview, true); assert.equal(changed.stages[0].residualAmountCents, 200000);
  const revised = { ...closed, cashPlan: { ...closed.cashPlan!, stages: closed.cashPlan!.stages.map((s) => s.id === "entry" ? { ...s, endDate: "2026-10-11", startDate: "2026-10-11" } : s) } };
  assert.equal(summarizeProjectCashPlan(revised, [bill]).stages[0].requiresReview, true);
});

test("rateio parcial, despesa cancelada e gasto superior à etapa", () => {
  const linked = { ...custom(), expenseIds: [bill.id], expenseStageIds: { [bill.id]: "entry" } };
  const split = { ...bill, hasAccountAllocations: true, accountAllocations: [{ accountPlanId: "material", amount: 1000 }, { accountPlanId: "outside", amount: 2000 }] };
  assert.equal(summarizeProjectCashPlan(linked, [split]).stages[0].residualAmountCents, 300000);
  assert.equal(summarizeProjectCashPlan(linked, [{ ...bill, status: "cancelled" }]).stages[0].residualAmountCents, 400000);
  assert.equal(summarizeProjectCashPlan(linked, [{ ...bill, totalValue: 5000 }]).stages[0].residualAmountCents, 0);
  assert.equal(summarizeProjectCashPlan(linked, [{ ...split, totalValue: 2900 }]).blocked, true);
});

test("vínculo sem etapa ou documento ausente suspende projeção com aviso", () => {
  const linked = { ...custom(), expenseIds: [bill.id] };
  assert.equal(summarizeProjectCashPlan(linked, [bill]).blocked, true);
  assert.equal(summarizeProjectCashPlan({ ...linked, expenseStageIds: { [bill.id]: "entry" } }, []).blocked, true);
  assert.equal(buildProjectCashProjections(linked, [bill], range).rows.length, 0);
  const strict = { ...linked, periodMode: undefined, expenseStageIds: { [bill.id]: "entry" } };
  assert.equal(summarizeProjectCashPlan(strict, [{ ...bill, competenceMonth: "2027-01" }]).blocked, true);
});

test("expectativa vencida não desaparece e inativação não cria movimento", () => {
  const later = buildProjectCashProjections(custom(), [], { from: "2027-01-01", to: "2027-01-31", today: "2027-01-10" });
  assert.equal(sum(later.rows), 1000000); assert.ok(later.rows.every((row) => row.date === "2027-01-10" && row.requiresReview));
  assert.equal(buildProjectCashProjections({ ...custom(), active: false }, [], range).rows.length, 0);
  assert.equal(buildProjectCashProjections(project, [], range).rows.length, 0);
});

test("provisão avulsa conflitante suspende só o projeto correspondente sem cancelar dados", () => {
  const rows = buildProjectCashProjections(custom(), [], range).rows;
  assert.equal(selectProjectCashProjections(rows, []).projections.length, rows.length);
  const collision = selectProjectCashProjections(rows, ["material"]);
  assert.equal(collision.conflictCount, 1); assert.equal(collision.projections.length, 0);
  assert.deepEqual(collision.accountPlanIds, []);
  assert.equal(sum(rows), 1000000);
});

test("período personalizado avisa competência externa sem descartá-la; contrato legado permanece", () => {
  const outside = { ...bill, competenceMonth: "2027-01" };
  assert.equal(calculateProjectBudgetConsumption(project, [outside]).consumedAmountCents, 300000);
  assert.equal(calculateProjectBudgetConsumption(project, [outside]).issues.length, 1);
  assert.equal(calculateProjectBudgetConsumption({ ...project, periodMode: undefined }, [outside]).consumedAmountCents, 0);
});
