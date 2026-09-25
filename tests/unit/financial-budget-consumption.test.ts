import assert from "node:assert/strict";
import test from "node:test";
import { buildBudgetBurndownData, calculateBudgetConsumption, calculateBudgetForecastCoverage } from "../../src/features/financial/lib/budget-consumption";

const budget = { accountPlanIds: ["insumos", "embalagens"], competenceMonth: "2026-10", budgetedAmountCents: 1200000 };

test("despesas pendentes e pagas comprometem o orçamento uma vez cada", () => {
  const expenses = [
    { id: "pedido", status: "pending", provisionType: "actual", competenceMonth: "2026-10", accountId: "insumos", totalValue: 3000, competenceDate: "2026-10-05" },
    { id: "avulsa", status: "paid", competenceMonth: "2026-10", accountPlan: "embalagens", totalValue: 2000, competenceDate: "2026-10-12" },
    { id: "forecast", status: "provisioned", provisionType: "forecast", competenceMonth: "2026-10", accountId: "insumos", totalValue: 9000 },
    { id: "reconciled", status: "reconciled", competenceMonth: "2026-10", accountId: "insumos", totalValue: 5000 },
    { id: "cancelled", status: "cancelled", competenceMonth: "2026-10", accountId: "insumos", totalValue: 5000 },
    { id: "other-month", status: "pending", competenceMonth: "2026-09", accountId: "insumos", totalValue: 1000 },
  ];
  const result = calculateBudgetConsumption(budget, expenses);
  assert.equal(result.consumedAmountCents, 500000);
  assert.equal(result.balanceAmountCents, 700000);
  assert.deepEqual(result.expenses.map((expense) => expense.id), ["pedido", "avulsa"]);
});

test("rateio inclui somente as parcelas das contas escolhidas e rejeita rateio inválido", () => {
  const result = calculateBudgetConsumption(budget, [
    { id: "valid", status: "pending", competenceMonth: "2026-10", totalValue: 300,
      hasAccountAllocations: true, accountAllocations: [
        { accountPlanId: "insumos", amount: 100 }, { accountPlanId: "fora", amount: 200 },
      ] },
    { id: "invalid", status: "pending", competenceMonth: "2026-10", totalValue: 300,
      hasAccountAllocations: true, accountAllocations: [
        { accountPlanId: "insumos", amount: 100 }, { accountPlanId: "fora", amount: 100 },
      ] },
  ]);
  assert.equal(result.consumedAmountCents, 10000);
  assert.deepEqual(result.issues, ["Rateio inválido na despesa invalid."]);
});

test("curva conserva a referência fixa e não desenha saldo realizado futuro", () => {
  const curve = buildBudgetBurndownData(budget, [
    { id: "purchase", status: "pending", competenceMonth: "2026-10", totalValue: 3000,
      accountPlan: "insumos", competenceDate: "2026-10-05" },
  ], "2026-10-07");
  assert.equal(curve.length, 31);
  assert.equal(curve[3].actualBalanceCents, 1200000);
  assert.equal(curve[4].actualBalanceCents, 900000);
  assert.equal(curve[7].actualBalanceCents, null);
  assert.equal(curve[30].plannedBalanceCents, 0);
});

test("mês de competência domina vencimento e data de criação posterior", () => {
  const result = calculateBudgetConsumption(budget, [
    { id: "late", status: "pending", competenceMonth: "2026-10", totalValue: 50,
      accountId: "insumos", createdAt: "2026-11-02T12:00:00Z" },
  ]);
  assert.equal(result.consumedAmountCents, 5000);
  assert.equal(result.expenses[0].impactDate, "2026-10-01");
});

test("provisões da mesma categoria cobrem parte da simulação de caixa sem consumir o orçamento", () => {
  const expense = { id: "previsto", status: "provisioned", provisionType: "forecast",
    competenceMonth: "2026-10", accountId: "insumos", totalValue: 500 };
  assert.equal(calculateBudgetConsumption(budget, [expense]).consumedAmountCents, 0);
  assert.equal(calculateBudgetForecastCoverage(budget, [expense]), 50000);
});
