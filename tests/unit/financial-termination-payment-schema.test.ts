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
