import assert from "node:assert/strict";
import test from "node:test";

import { interBarcodePaymentPayload } from "../../../src/lib/integrations/inter/barcode-payments.server";

const payment = {
  code: "1".repeat(47),
  amount: 1467.98,
  dueDate: "2026-10-05",
  scheduledFor: "2026-10-06",
  beneficiaryDocument: "05.695.860/0001-00",
};

test("serializa valor do pagamento unitário como string decimal exigida pelo Inter", () => {
  assert.deepEqual(interBarcodePaymentPayload(payment, "2026-10-06"), {
    codBarraLinhaDigitavel: payment.code,
    valorPagar: "1467.98",
    dataVencimento: "2026-10-05",
    cpfCnpjBeneficiario: "05695860000100",
  });
});

test("inclui data de pagamento somente em agendamento futuro", () => {
  assert.equal(interBarcodePaymentPayload({ ...payment, scheduledFor: "2026-10-07" }, "2026-10-06").dataPagamento, "2026-10-07");
  assert.equal("dataPagamento" in interBarcodePaymentPayload(payment, "2026-10-06"), false);
});
