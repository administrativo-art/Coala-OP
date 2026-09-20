import assert from "node:assert/strict";
import test from "node:test";

import {
  dreExpenseDetailReferences,
  formatDreServiceNumber,
  groupDreExpenseDetailsByAccount,
} from "../../src/features/financial/lib/dre-expense-details";
import type { DreExpenseLineDetail } from "../../src/features/financial/lib/dre-expense-calculation";

test("agrupa o detalhamento da DRE por plano e consolida a mesma despesa", () => {
  const details: DreExpenseLineDetail[] = [
    {
      expenseId: "expense-1",
      description: "DAS Simples Nacional",
      supplier: "Receita Federal",
      accountPlanId: "cofins",
      accountPlanName: "Cofins do DAS",
      amount: 540,
    },
    {
      expenseId: "expense-1",
      description: "DAS Simples Nacional",
      supplier: "Receita Federal",
      accountPlanId: "cofins",
      accountPlanName: "Cofins do DAS",
      amount: 8.80,
    },
    {
      expenseId: "expense-1",
      description: "DAS Simples Nacional",
      supplier: "Receita Federal",
      accountPlanId: "cpp",
      accountPlanName: "CPP do DAS",
      amount: 1_809.25,
    },
  ];

  const groups = groupDreExpenseDetailsByAccount(details);

  assert.deepEqual(groups.map((group) => ({
    name: group.accountPlanName,
    total: group.totalAmount,
    expenseAmounts: group.expenses.map((expense) => expense.amount),
  })), [
    { name: "Cofins do DAS", total: 548.80, expenseAmounts: [548.80] },
    { name: "CPP do DAS", total: 1_809.25, expenseAmounts: [1_809.25] },
  ]);
});

test("identifica a linha de celular ou sinaliza quando o cartão não informa o número", () => {
  assert.equal(formatDreServiceNumber("+5598987846117"), "(98) 98784-6117");
  assert.deepEqual(dreExpenseDetailReferences({
    expenseId: "mobile-bill",
    description: "Conta de celular - 08/2026 | Vivo",
    supplier: "Vivo",
    accountPlanId: "mobile",
    accountPlanName: "Conta de celular",
    amount: 39.99,
    billingIdentity: {
      customerAccount: "0466955628",
      serviceNumbers: ["+5598987846117"],
    },
  }), ["Linha (98) 98784-6117", "Conta 0466955628"]);
  assert.deepEqual(dreExpenseDetailReferences({
    expenseId: "card-charge",
    description: "Conta de celular - 08/2026 | Vivo",
    supplier: "Vivo",
    accountPlanId: "mobile",
    accountPlanName: "Conta de celular",
    amount: 39.99,
    cardChargeDate: "2026-08-17",
  }), ["Compra no cartão em 17/08/2026", "Linha não identificada"]);
});
