import assert from "node:assert/strict";
import test from "node:test";

import {
  expensePersonAllocations,
  personAllocationAccountTotals,
  personAllocationDifference,
  personAllocationDistinctPeopleCount,
  personAllocationsAreValid,
} from "../../src/features/financial/lib/expense-person-allocations";

const personAllocations = [
  {
    id: "fgts-aliny",
    accountPlanId: "fgts",
    employeeId: "aliny",
    employeeName: "Aliny Rodrigues",
    analysisType: "employer_cost" as const,
    amount: 101.48,
    resultCenter: "Shopping do Automóvel",
    payrollDocumentId: "recibo-aliny-2026-07",
  },
  {
    id: "fgts-carliane",
    accountPlanId: "fgts",
    employeeId: "carliane",
    employeeName: "Carliane Sousa",
    analysisType: "employer_cost" as const,
    amount: 180.15,
    resultCenter: "Quiosque Tirirical",
  },
  {
    id: "consignado-carliane-1",
    accountPlanId: "consignado",
    employeeId: "carliane",
    employeeName: "Carliane Sousa",
    analysisType: "employee_deduction" as const,
    amount: 288.43,
    resultCenter: "Quiosque Tirirical",
    contractReference: "Empréstimo 1",
  },
];

test("valida a matriz conta × colaborador pelo total de cada conta", () => {
  assert.equal(personAllocationsAreValid({
    totalValue: 570.06,
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "fgts", amount: 281.63 },
      { accountPlanId: "consignado", amount: 288.43 },
    ],
    hasPersonAllocations: true,
    personAllocations,
  }), true);

  assert.deepEqual(
    Array.from(personAllocationAccountTotals(personAllocations).entries()),
    [["fgts", 281.63], ["consignado", 288.43]],
  );
  assert.equal(personAllocationDifference(personAllocations, 570.06), 0);
  assert.equal(
    expensePersonAllocations({ hasPersonAllocations: true, personAllocations })[0]?.payrollDocumentId,
    "recibo-aliny-2026-07",
  );
});

test("rejeita conta sem fechamento individual ou colaborador sem centro", () => {
  assert.equal(personAllocationsAreValid({
    totalValue: 570.06,
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "fgts", amount: 281.64 },
      { accountPlanId: "consignado", amount: 288.42 },
    ],
    hasPersonAllocations: true,
    personAllocations,
  }), false);

  assert.equal(personAllocationsAreValid({
    totalValue: 570.06,
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "fgts", amount: 281.63 },
      { accountPlanId: "consignado", amount: 288.43 },
    ],
    hasPersonAllocations: true,
    personAllocations: personAllocations.map((entry, index) => index === 0 ? { ...entry, resultCenter: "" } : entry),
  }), false);
});

test("conta pessoas distintas sem confundir múltiplos vínculos da mesma pessoa", () => {
  assert.equal(personAllocationDistinctPeopleCount(personAllocations), 2);
  assert.equal(personAllocationDistinctPeopleCount([
    personAllocations[1],
    personAllocations[2],
  ]), 1);
});
