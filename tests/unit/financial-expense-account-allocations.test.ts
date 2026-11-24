import assert from "node:assert/strict";
import test from "node:test";
import { expenseValueForResultCenter } from "../../src/features/financial/lib/expense-rateio";

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

test("DAS e IR/CSLL: cada conta conserva seu total nos centros e qualquer subconjunto usa a mesma distribuição", () => {
  const expense = {
    totalValue: 4361.70, hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "irpj", amount: 239.89 }, { accountPlanId: "csll", amount: 152.66 },
      { accountPlanId: "cofins", amount: 555.68 }, { accountPlanId: "pis", amount: 120.38 },
      { accountPlanId: "cpp", amount: 1831.92 }, { accountPlanId: "icms", amount: 1461.17 },
    ],
    isApportioned: true, apportionments: [
      { resultCenter: "a", percentage: 33.33 }, { resultCenter: "b", percentage: 33.33 }, { resultCenter: "c", percentage: 33.34 },
    ],
  };
  const names = { a: "Loja A", b: "Loja B", c: "Loja C" };
  const all = ["Loja A", "Loja B", "Loja C"].map(center => expenseAccountAllocationsForResultCenter(expense, center, names));
  for (let index = 0; index < expense.accountAllocations.length; index++) {
    assert.equal(all.reduce((sum, row) => sum + Math.round(row[index].amount * 100), 0), Math.round(expense.accountAllocations[index].amount * 100));
    assert.equal(Math.round(all[0][index].amount * 100) + Math.round(all[2][index].amount * 100),
      Math.round(expense.accountAllocations[index].amount * 100) - Math.round(all[1][index].amount * 100));
  }
  assert.deepEqual(expenseAccountAllocationsForResultCenter({ ...expense, apportionments: [...expense.apportionments].reverse() }, "Loja A", names), all[0]);
  assert.equal(all.flat().reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 436170);
  for (let index = 0; index < all.length; index++) {
    assert.equal(Math.round(expenseValueForResultCenter(expense, ["Loja A", "Loja B", "Loja C"][index], names) * 100),
      all[index].reduce((sum, row) => sum + Math.round(row.amount * 100), 0));
  }
});
