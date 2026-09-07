import assert from "node:assert/strict";
import test from "node:test";

import { chooseExistingExpenseSuggestion } from "../../src/features/financial/inbox/expense-suggestions";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

const classification: FinancialInboxClassification = {
  documentType: "charge",
  financeLikely: true,
  confidence: "medium",
  supplierName: "Marvi",
  competence: null,
  dueDate: "2026-09-07",
  amountCents: 113884,
  barcode: null,
  barcodeMasked: null,
  links: [],
};

function marviExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: "expense-nfe-872460-marvi-20260817",
    description: "Compra Marvi Alimentos | NF 872460",
    supplier: "Marvi Alimentos",
    totalValue: 3416.85,
    status: "pending",
    installments: [
      {
        number: 1,
        value: 1138.84,
        dueDate: "2026-09-07",
        status: "pending",
        bankPaymentTransactionId: "inter-payment-1",
        bankPaymentStatus: "AGUARDANDO_APROVACAO",
        paymentSchedulingStatus: "awaiting_approval",
      },
      { number: 2, value: 1138.84, dueDate: "2026-09-14", status: "pending" },
      { number: 3, value: 1139.17, dueDate: "2026-09-21", status: "pending" },
    ],
    ...overrides,
  };
}

test("sugere a parcela exata e preserva o agendamento existente no Inter", () => {
  const suggestion = chooseExistingExpenseSuggestion(classification, [marviExpense()]);

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.expenseId, "expense-nfe-872460-marvi-20260817");
  assert.equal(suggestion.installmentNumber, 1);
  assert.equal(suggestion.installmentTotal, 3);
  assert.equal(suggestion.paymentState, "scheduled");
  assert.equal(suggestion.existingBankPayment?.transactionId, "inter-payment-1");
});

test("prioriza pagamento confirmado pelo extrato sobre um agendamento anterior", () => {
  const suggestion = chooseExistingExpenseSuggestion(classification, [marviExpense({
    status: "paid",
    settlementEvidence: [{ transactionId: "statement-transaction-1", paidAt: "2026-09-06" }],
  })]);

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.paymentState, "paid");
  assert.equal(suggestion.existingSettlement?.transactionId, "statement-transaction-1");
  assert.equal(suggestion.existingSettlement?.paidAt, "2026-09-06");
  assert.equal(suggestion.existingBankPayment, null);
});

test("indica necessidade de agendamento quando a parcela não tem pagamento", () => {
  const expense = marviExpense();
  expense.installments[0] = {
    number: 1,
    value: 1138.84,
    dueDate: "2026-09-07",
    status: "pending",
  };
  const suggestion = chooseExistingExpenseSuggestion(classification, [expense]);

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.paymentState, "needs_scheduling");
});

test("não cruza fornecedor diferente mesmo com valor e vencimento iguais", () => {
  const suggestion = chooseExistingExpenseSuggestion(classification, [marviExpense({ supplier: "Outro Fornecedor" })]);
  assert.equal(suggestion.status, "not_found");
});

test("não escolhe automaticamente quando duas parcelas são equivalentes", () => {
  const suggestion = chooseExistingExpenseSuggestion(classification, [marviExpense(), {
    ...marviExpense(),
    id: "another-expense",
  }]);
  assert.equal(suggestion.status, "ambiguous");
});
