import assert from "node:assert/strict";
import test from "node:test";

import { createPaymentRequestSchema } from "../../src/features/financial/payment-requests/schemas";

test("solicitação de pagamento aceita a rescisão como origem protegida", () => {
  const result = createPaymentRequestSchema.parse({
    sourceType: "termination",
    sourceId: "termination-test",
    beneficiaryReference: { sourceType: "employee", sourceId: "employee-test" },
    amount: 1234.56,
    description: "Rescisão CLT — Pessoa Teste",
  });
  assert.equal(result.sourceType, "termination");
  assert.equal(result.amount, 1234.56);
});

test("solicitação de pagamento aceita pedido de compra como origem", () => {
  const result = createPaymentRequestSchema.parse({
    sourceType: "purchase_order",
    sourceId: "purchase-test",
    expenseId: "expense-test",
    beneficiaryReference: { sourceType: "entity", sourceId: "supplier-test" },
    amount: 2547.86,
    description: "Compra Cantinho | Pedido 157.816",
  });
  assert.equal(result.sourceType, "purchase_order");
  assert.equal(result.expenseId, "expense-test");
});

test("solicitação de pagamento aceita salário como origem", () => {
  const result = createPaymentRequestSchema.parse({
    sourceType: "salary",
    sourceId: "salary_202609_employee-test",
    expenseId: "salary_202609_employee-test",
    beneficiaryReference: { sourceType: "employee", sourceId: "employee-test" },
    amount: 1768.82,
    description: "Salário - 09/2026 | Pessoa Teste",
    scheduledFor: "2026-10-06",
  });
  assert.equal(result.sourceType, "salary");
  assert.equal(result.scheduledFor, "2026-10-06");
});
