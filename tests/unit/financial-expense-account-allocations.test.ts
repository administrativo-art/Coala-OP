import assert from "node:assert/strict";
import test from "node:test";

import {
  accountAllocationDifference,
  accountAllocationsAreValid,
  expenseAccountAllocations,
  expenseAccountAllocationsForResultCenter,
} from "../../src/features/financial/lib/expense-account-allocations";

test("mantém despesas legadas como uma única apropriação", () => {
  assert.deepEqual(
    expenseAccountAllocations({ accountPlan: "das", accountPlanName: "DAS", totalValue: 3921.78 }),
    [{ accountPlanId: "das", accountPlanName: "DAS", amount: 3921.78 }],
  );
});

test("valida apropriações pelo total em centavos e por contas únicas", () => {
  const allocations = [
    { accountPlanId: "icms", amount: 1313.79 },
    { accountPlanId: "cpp", amount: 1647.15 },
    { accountPlanId: "outros", amount: 960.84 },
  ];
  assert.equal(accountAllocationsAreValid(allocations, 3921.78), true);
  assert.equal(accountAllocationDifference(allocations, 3921.78), 0);
  assert.equal(accountAllocationsAreValid([...allocations, { accountPlanId: "cpp", amount: 1 }], 3922.78), false);
});

test("cruza cada apropriação contábil com o rateio por centro de resultado", () => {
  const expense = {
    totalValue: 300,
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "icms", accountPlanName: "ICMS do DAS", amount: 120 },
      { accountPlanId: "cpp", accountPlanName: "CPP do DAS", amount: 180 },
    ],
    isApportioned: true,
    apportionments: [
      { resultCenter: "Tirirical", percentage: 60 },
      { resultCenter: "João Paulo", percentage: 40 },
    ],
  };

  assert.deepEqual(expenseAccountAllocationsForResultCenter(expense, "Tirirical"), [
    { accountPlanId: "icms", accountPlanName: "ICMS do DAS", amount: 72 },
    { accountPlanId: "cpp", accountPlanName: "CPP do DAS", amount: 108 },
  ]);
});

test("prioriza a matriz individual por conta e centro quando ela existe", () => {
  const expense = {
    totalValue: 300,
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "fgts", accountPlanName: "FGTS", amount: 120 },
      { accountPlanId: "consignado", accountPlanName: "Consignado", amount: 180 },
    ],
    hasPersonAllocations: true,
    personAllocations: [
      { accountPlanId: "fgts", employeeId: "a", employeeName: "A", analysisType: "employer_cost" as const, amount: 80, resultCenter: "Tirirical" },
      { accountPlanId: "fgts", employeeId: "b", employeeName: "B", analysisType: "employer_cost" as const, amount: 40, resultCenter: "João Paulo" },
      { accountPlanId: "consignado", employeeId: "a", employeeName: "A", analysisType: "employee_deduction" as const, amount: 30, resultCenter: "Tirirical" },
      { accountPlanId: "consignado", employeeId: "b", employeeName: "B", analysisType: "employee_deduction" as const, amount: 150, resultCenter: "João Paulo" },
    ],
    isApportioned: true,
    apportionments: [
      { resultCenter: "Tirirical", percentage: 60 },
      { resultCenter: "João Paulo", percentage: 40 },
    ],
  };

  assert.deepEqual(expenseAccountAllocationsForResultCenter(expense, "Tirirical"), [
    { accountPlanId: "fgts", accountPlanName: "FGTS", amount: 80 },
    { accountPlanId: "consignado", accountPlanName: "Consignado", amount: 30 },
  ]);
});
