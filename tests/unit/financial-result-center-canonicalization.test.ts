import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeExpenseDraftResultCenters,
  expenseDraftResultCenterIds,
} from "../../src/features/financial/lib/result-center-canonicalization";

const namesById = {
  admin: "Centro administrativo - Renascença",
  jp: "Quiosque João Paulo",
  tirirical: "Quiosque Tirirical",
};

test("substitui o nome legado pelo nome atual do centro antes da efetivação", () => {
  const result = canonicalizeExpenseDraftResultCenters({
    mode: "new",
    resultCenterId: "admin",
    resultCenterName: "Centro de distribuição - Matriz",
  }, namesById);

  assert.equal(result.resultCenterId, "admin");
  assert.equal(result.resultCenterName, "Centro administrativo - Renascença");
});

test("canoniza centros ativos em rateios e individualizações", () => {
  const result = canonicalizeExpenseDraftResultCenters({
    mode: "new",
    resultCenterId: "admin",
    resultCenterName: "Matriz antiga",
    isApportioned: true,
    apportionments: [
      { resultCenterId: "jp", resultCenterName: "JP antigo", percentage: 50 },
      { resultCenterId: "tirirical", resultCenterName: "Tirirical antigo", percentage: 50 },
    ],
    hasPersonAllocations: true,
    personAllocations: [
      { resultCenterId: "jp", resultCenterName: "JP antigo", amount: 100 },
    ],
  }, namesById);

  assert.deepEqual(result.apportionments, [
    { resultCenterId: "jp", resultCenterName: "Quiosque João Paulo", percentage: 50 },
    { resultCenterId: "tirirical", resultCenterName: "Quiosque Tirirical", percentage: 50 },
  ]);
  assert.deepEqual(result.personAllocations, [
    { resultCenterId: "jp", resultCenterName: "Quiosque João Paulo", amount: 100 },
  ]);
});

test("canoniza cada centro de uma despesa dividida e elimina IDs repetidos", () => {
  const draft = {
    mode: "split",
    resultCenterId: "removido",
    resultCenterName: "Centro antigo que não participa da divisão",
    splitExpenses: [
      { resultCenterId: "jp", resultCenterName: "JP antigo" },
      { resultCenterId: "jp", resultCenterName: "Outro nome antigo" },
      { resultCenterId: "tirirical", resultCenterName: "Tirirical antigo" },
    ],
  };

  assert.deepEqual(expenseDraftResultCenterIds(draft), ["jp", "tirirical"]);
  assert.equal(canonicalizeExpenseDraftResultCenters(draft, namesById).resultCenterName, draft.resultCenterName);
  assert.deepEqual(
    canonicalizeExpenseDraftResultCenters(draft, namesById).splitExpenses,
    [
      { resultCenterId: "jp", resultCenterName: "Quiosque João Paulo" },
      { resultCenterId: "jp", resultCenterName: "Quiosque João Paulo" },
      { resultCenterId: "tirirical", resultCenterName: "Quiosque Tirirical" },
    ],
  );
});

test("recusa um ID que não existe no cadastro atual", () => {
  assert.throws(
    () => canonicalizeExpenseDraftResultCenters({
      mode: "new",
      resultCenterId: "removido",
      resultCenterName: "Centro removido",
    }, namesById),
    /RESULT_CENTER_NOT_FOUND/,
  );
});

test("ignora estruturas antigas que não participam da classificação ativa", () => {
  const draft = {
    mode: "new",
    resultCenterId: "admin",
    resultCenterName: "Matriz antiga",
    isApportioned: false,
    apportionments: [{ resultCenterId: "removido", resultCenterName: "Centro removido" }],
    hasPersonAllocations: false,
    personAllocations: [{ resultCenterId: "removido", resultCenterName: "Centro removido" }],
    splitExpenses: [{ resultCenterId: "removido", resultCenterName: "Centro removido" }],
  };

  assert.deepEqual(expenseDraftResultCenterIds(draft), ["admin"]);
  assert.equal(canonicalizeExpenseDraftResultCenters(draft, namesById).resultCenterName, namesById.admin);
});

test("não revalida centro do rascunho ao pagar despesa existente ou compra", () => {
  assert.deepEqual(expenseDraftResultCenterIds({
    mode: "existing",
    linkedExpenseId: "expense-1",
    resultCenterId: "removido",
  }), []);
  assert.deepEqual(expenseDraftResultCenterIds({
    mode: "purchase",
    purchaseOrderId: "order-1",
    resultCenterId: "removido",
  }), []);
});
