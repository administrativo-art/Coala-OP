import assert from "node:assert/strict";
import test from "node:test";

import { calculateDreExpenses } from "../../src/features/financial/lib/dre-expense-calculation";
import {
  financialExpenseCompetenceMonth,
  financialExpenseParticipatesInDre,
  normalizeFinancialExpenseForDre,
} from "../../src/features/financial/lib/expense-accounting-contract";

const accounts = {
  salary: { name: "Salários", drePosition: "pessoal", isDreAccount: true },
  advance: { name: "Adiantamento salarial", drePosition: "pessoal", isDreAccount: true },
  occupancy: { name: "Ocupação", drePosition: "ocupacao", isDreAccount: true },
};

test("competência contábil não recua de mês nem usa vencimento ou pagamento", () => {
  assert.equal(financialExpenseCompetenceMonth({
    competenceDate: new Date("2026-08-01T00:00:00.000Z"),
    paidAt: new Date("2026-09-05T15:00:00.000Z"),
  } as never), "2026-08");
  assert.equal(financialExpenseCompetenceMonth({
    dueDate: new Date("2026-08-10T15:00:00.000Z"),
    paidAt: new Date("2026-08-11T15:00:00.000Z"),
  } as never), null);
});

test("DRE soma salário líquido e adiantamento na mesma competência, independentemente do caixa", () => {
  const expenses = [
    normalizeFinancialExpenseForDre("salary", {
      status: "paid",
      competenceMonth: "2026-08",
      competenceDate: new Date("2026-08-01T00:00:00.000Z"),
      dueDate: new Date("2026-09-05T15:00:00.000Z"),
      paidAt: new Date("2026-09-05T15:00:00.000Z"),
      accountPlan: "salary",
      totalValue: 1_000,
      resultCenter: "center-jp",
    }),
    normalizeFinancialExpenseForDre("advance", {
      status: "paid",
      competenceMonth: "2026-08",
      competenceDate: new Date("2026-08-01T15:00:00.000Z"),
      paidAt: new Date("2026-08-15T15:00:00.000Z"),
      accountPlan: "advance",
      totalValue: 300,
      resultCenter: "center-jp",
    }),
  ];

  const result = calculateDreExpenses({
    expenses,
    accounts,
    monthKey: "2026-08",
    resultCenter: "Quiosque João Paulo",
    resultCenterNames: { "center-jp": "Quiosque João Paulo" },
  });

  assert.equal(result.totalsByPosition.pessoal, 1_300);
  assert.deepEqual(result.issues, []);
});

test("DRE preserva as despesas que compõem cada linha e o valor da unidade", () => {
  const expense = normalizeFinancialExpenseForDre("shared-rent", {
    status: "paid",
    competenceMonth: "2026-08",
    description: "Aluguel do quiosque",
    supplier: "Imobiliária Exemplo",
    accountPlan: "occupancy",
    totalValue: 1_000,
    isApportioned: true,
    apportionments: [
      { resultCenter: "center-jp", percentage: 60 },
      { resultCenter: "center-other", percentage: 40 },
    ],
  });

  const result = calculateDreExpenses({
    expenses: [expense],
    accounts,
    monthKey: "2026-08",
    resultCenter: "Quiosque João Paulo",
    resultCenterNames: {
      "center-jp": "Quiosque João Paulo",
      "center-other": "Outro quiosque",
    },
  });

  assert.equal(result.totalsByPosition.ocupacao, 600);
  assert.deepEqual(result.detailsByPosition.ocupacao, [{
    expenseId: "shared-rent",
    description: "Aluguel do quiosque",
    supplier: "Imobiliária Exemplo",
    accountPlanId: "occupancy",
    accountPlanName: "Ocupação",
    amount: 600,
  }]);
});

test("DRE exclui título sem competência mesmo que tenha vencimento e pagamento", () => {
  const expense = normalizeFinancialExpenseForDre("without-competence", {
    status: "paid",
    dueDate: new Date("2026-08-10T15:00:00.000Z"),
    paidAt: new Date("2026-08-11T15:00:00.000Z"),
    accountPlan: "salary",
    totalValue: 500,
    resultCenter: "center-jp",
  });

  assert.equal(financialExpenseParticipatesInDre(expense), false);
  assert.deepEqual(calculateDreExpenses({
    expenses: [expense],
    accounts,
    monthKey: "2026-08",
    resultCenterNames: { "center-jp": "Quiosque João Paulo" },
  }), {
    totalsByPosition: {},
    detailsByPosition: {},
    issues: [],
  });
});

test("expõe apropriação que não fecha o valor total em vez de omitir a diferença silenciosamente", () => {
  const expense = normalizeFinancialExpenseForDre("occupancy", {
    status: "paid",
    competenceMonth: "2026-08",
    accountPlan: "occupancy",
    totalValue: 145,
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "occupancy", amount: 50 },
      { accountPlanId: "salary", amount: 90 },
    ],
    resultCenter: "center-jp",
  });

  const result = calculateDreExpenses({
    expenses: [expense],
    accounts,
    monthKey: "2026-08",
    resultCenterNames: { "center-jp": "Quiosque João Paulo" },
  });

  assert.deepEqual(result.issues, [{
    expenseId: "occupancy",
    code: "account_allocation_mismatch",
    differenceCents: 500,
  }]);
});

test("normaliza identificadores legados de centro sem perder a individualização", () => {
  const expense = normalizeFinancialExpenseForDre("vacation", {
    status: "paid",
    competenceMonth: "2026-09",
    accountPlan: "salary",
    totalValue: 427.63,
    hasPersonAllocations: true,
    personAllocations: [{
      accountPlanId: "salary",
      employeeId: "employee-1",
      employeeName: "Colaboradora",
      analysisType: "employer_cost",
      amount: 427.63,
      resultCenterId: "center-jp",
      resultCenterName: "Quiosque João Paulo",
    }],
    resultCenterId: "center-jp",
  });

  const result = calculateDreExpenses({
    expenses: [expense],
    accounts,
    monthKey: "2026-09",
    resultCenter: "Quiosque João Paulo",
    resultCenterNames: { "center-jp": "Quiosque João Paulo" },
  });

  assert.equal(result.totalsByPosition.pessoal, 427.63);
  assert.deepEqual(result.issues, []);
});
