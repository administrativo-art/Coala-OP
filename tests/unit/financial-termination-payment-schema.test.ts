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
