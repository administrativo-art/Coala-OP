import assert from "node:assert/strict";
import test from "node:test";

import { buildDrePersonAnalysis } from "../../src/features/financial/lib/dre-person-analysis";

const accounts = {
  salary: { name: "Salários", drePosition: "pessoal", isDreAccount: true },
  bonus: { name: "Gratificações por função", drePosition: "pessoal", isDreAccount: true },
  fgts: { name: "FGTS", drePosition: "pessoal", isDreAccount: true },
  inss: { name: "INSS descontado a recolher", drePosition: null, isDreAccount: false },
  loan: { name: "Empréstimos consignados a recolher", drePosition: null, isDreAccount: false },
};

const expenses = [
  {
    id: "salary-heucilene",
    status: "pending",
    description: "Salário - 08/2026 | Heucilene Oliveira",
    competenceDate: new Date(2026, 7, 1),
    totalValue: 2300,
    hasPersonAllocations: true,
    personAllocations: [
      { accountPlanId: "salary", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employer_cost", amount: 1000, resultCenter: "João Paulo" },
      { accountPlanId: "salary", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employer_cost", amount: 1000, resultCenter: "Tirirical" },
      { accountPlanId: "bonus", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employer_cost", amount: 150, resultCenter: "João Paulo" },
      { accountPlanId: "bonus", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employer_cost", amount: 150, resultCenter: "Tirirical" },
    ],
  },
  {
    id: "fgts-and-loans",
    status: "pending",
    competenceDate: new Date(2026, 7, 1),
    totalValue: 780,
    hasPersonAllocations: true,
    personAllocations: [
      { accountPlanId: "fgts", employeeId: "aliny", employeeName: "Aliny Rodrigues", analysisType: "employer_cost", amount: 160, resultCenter: "Shopping do Automóvel" },
      { accountPlanId: "fgts", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employer_cost", amount: 80, resultCenter: "João Paulo" },
      { accountPlanId: "fgts", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employer_cost", amount: 80, resultCenter: "Tirirical" },
      { accountPlanId: "loan", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employee_deduction", amount: 200, resultCenter: "João Paulo" },
      { accountPlanId: "loan", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employee_deduction", amount: 200, resultCenter: "Tirirical" },
      { accountPlanId: "inss", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employee_deduction", amount: 30, resultCenter: "João Paulo" },
      { accountPlanId: "inss", employeeId: "heucilene", employeeName: "Heucilene Oliveira", analysisType: "employee_deduction", amount: 30, resultCenter: "Tirirical" },
    ],
  },
  {
    id: "legacy-salary-samila",
    status: "paid",
    description: "Salário - 08/2026 | Samila Cardoso",
    supplier: "Samila Cardoso",
    competenceDate: new Date(2026, 7, 1),
    totalValue: 1500,
    accountPlan: "salary",
    resultCenter: "João Paulo",
  },
  {
    id: "cancelled-salary",
    status: "cancelled",
    description: "Salário - 08/2026 | Pessoa Cancelada",
    competenceDate: new Date(2026, 7, 1),
    totalValue: 999,
    accountPlan: "salary",
    resultCenter: "João Paulo",
  },
];

test("consolida o custo DRE por colaborador sem somar INSS descontado e consignado", () => {
  const analysis = buildDrePersonAnalysis({ expenses, accounts, monthKey: "2026-08" });
  const heucilene = analysis.people.find((person) => person.employeeId === "heucilene");

  assert.equal(analysis.people.length, 3);
  assert.equal(analysis.employerCost, 4120);
  assert.equal(analysis.employeeDeductions, 460);
  assert.equal(heucilene?.salary, 2000);
  assert.equal(heucilene?.bonuses, 300);
  assert.equal(heucilene?.fgts, 160);
  assert.equal(heucilene?.employerCost, 2460);
  assert.equal(heucilene?.inssDeduction, 60);
  assert.equal(heucilene?.payrollLoans, 400);
  assert.equal(heucilene?.employeeDeductions, 460);
});

test("aplica o centro de resultado também sobre a individualização", () => {
  const analysis = buildDrePersonAnalysis({
    expenses,
    accounts,
    monthKey: "2026-08",
    resultCenter: "João Paulo",
  });
  const heucilene = analysis.people.find((person) => person.employeeId === "heucilene");

  assert.equal(analysis.people.length, 2);
  assert.equal(analysis.employerCost, 2730);
  assert.equal(analysis.employeeDeductions, 230);
  assert.equal(heucilene?.salary, 1000);
  assert.equal(heucilene?.bonuses, 150);
  assert.equal(heucilene?.fgts, 80);
  assert.equal(heucilene?.employerCost, 1230);
  assert.deepEqual(heucilene?.resultCenters, ["João Paulo"]);
});
