import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerReportedPaymentSchema } from "../../src/features/financial/obligations/schemas";

const baseInput = {
  idempotencyKey: "payment-attempt-2026-08-19",
  paidAt: "2026-08-19T12:00:00-03:00",
  interest: 0,
  fine: 0,
  notes: "",
  splits: [{
    accountId: "inter",
    accountName: "Banco Inter",
    paymentMethodId: "pix",
    paymentMethodLabel: "Pix",
    amount: 100,
  }],
};

describe("registro informado de pagamento", () => {
  it("aceita pagamento sem encargos e sem plano financeiro", () => {
    assert.equal(registerReportedPaymentSchema.safeParse(baseInput).success, true);
  });

  it("exige plano de contas quando há juros ou multa", () => {
    const result = registerReportedPaymentSchema.safeParse({ ...baseInput, fine: 5, splits: [{ ...baseInput.splits[0], amount: 105 }] });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.issues[0].path[0], "chargesAccountPlanId");
  });

  it("aceita encargos classificados em plano explícito", () => {
    const result = registerReportedPaymentSchema.safeParse({
      ...baseInput,
      interest: 3,
      fine: 2,
      chargesAccountPlanId: "despesas-financeiras",
      chargesAccountPlanName: "Juros e multas",
      splits: [{ ...baseInput.splits[0], amount: 105 }],
    });
    assert.equal(result.success, true);
  });
});
