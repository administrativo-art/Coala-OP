import assert from "node:assert/strict";
import test from "node:test";

import { findInstallmentMatch } from "../../src/features/financial/lib/import-matcher";

const entry = {
  date: new Date("2026-08-24T12:00:00-03:00"),
  amount: -917.94,
  description: "PAGAMENTO NATUCOPOS",
};

test("pré-vincula automaticamente somente uma parcela única com valor em centavos", () => {
  const match = findInstallmentMatch(entry, [
    {
      expenseId: "expense-1",
      expenseDescription: "Compra Natucopos",
      installmentNumber: 1,
      dueDate: new Date("2026-08-23T12:00:00-03:00"),
      value: 917.94,
    },
  ]);

  assert.equal(match?.suggestedExpenseId, "expense-1");
  assert.equal(match?.suggestedInstallmentNumber, 1);
  assert.equal(match?.suggestedConfidence, "high");
});

test("não escolhe automaticamente entre duas parcelas indistinguíveis", () => {
  const match = findInstallmentMatch(entry, [
    {
      expenseId: "expense-1",
      expenseDescription: "Compra A",
      installmentNumber: 1,
      dueDate: new Date("2026-08-23T12:00:00-03:00"),
      value: 917.94,
    },
    {
      expenseId: "expense-2",
      expenseDescription: "Compra B",
      installmentNumber: 1,
      dueDate: new Date("2026-08-25T12:00:00-03:00"),
      value: 917.94,
    },
  ]);

  assert.equal(match, null);
});
