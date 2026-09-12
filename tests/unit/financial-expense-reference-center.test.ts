import assert from "node:assert/strict";
import test from "node:test";

import {
  expenseReferenceCenterFields,
  expenseReferenceCenterLabel,
  inheritExpenseReferenceCenter,
  resolveExpenseReferenceCenter,
} from "../../src/features/financial/lib/expense-reference-center";

test("mantém o centro de referência separado do rateio", () => {
  const expense = {
    isApportioned: true,
    referenceResultCenterId: "admin",
    referenceResultCenterName: "Centro administrativo",
    resultCenter: null,
  };

  assert.deepEqual(resolveExpenseReferenceCenter(expense), {
    id: "admin",
    name: "Centro administrativo",
  });
  assert.equal(expenseReferenceCenterLabel(expense), "Centro administrativo");
});

test("lê o centro legado sem alterar o registro", () => {
  assert.deepEqual(resolveExpenseReferenceCenter({ resultCenter: "quiosque-a" }, {
    "quiosque-a": "Quiosque A",
  }), {
    id: "quiosque-a",
    name: "Quiosque A",
  });
});

test("assume o centro administrativo para rateios legados sem referência", () => {
  assert.deepEqual(resolveExpenseReferenceCenter({ isApportioned: true }), {
    id: "KNKNWZ7tdhIxnrlStRum",
    name: "Centro administrativo - Renascença",
  });
});

test("a despesa real herda o centro de referência da provisão quando estiver ausente", () => {
  assert.deepEqual(inheritExpenseReferenceCenter(
    { isApportioned: true, resultCenter: null },
    { referenceResultCenterId: "admin", referenceResultCenterName: "Centro administrativo" },
  ), {
    referenceResultCenterId: "admin",
    referenceResultCenterName: "Centro administrativo",
  });
});

test("não substitui um centro de referência já informado", () => {
  assert.deepEqual(inheritExpenseReferenceCenter(
    { referenceResultCenterId: "a", referenceResultCenterName: "Centro A" },
    { referenceResultCenterId: "b", referenceResultCenterName: "Centro B" },
  ), expenseReferenceCenterFields({ id: "a", name: "Centro A" }));
});
