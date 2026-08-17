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
