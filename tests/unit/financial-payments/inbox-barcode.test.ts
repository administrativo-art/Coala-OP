import assert from "node:assert/strict";
import test from "node:test";

import { inboxBarcodePaymentPreparationSchema } from "../../../src/features/financial/payment-requests/inbox-barcode";

const valid = {
  scheduledFor: "2026-10-10",
  barcode: "8".repeat(48),
  beneficiaryDocument: "11.222.333/0001-81",
};

test("preparação da caixa normaliza e exige CNPJ válido do favorecido", () => {
  assert.equal(inboxBarcodePaymentPreparationSchema.parse(valid).beneficiaryDocument, "11222333000181");
  assert.equal(inboxBarcodePaymentPreparationSchema.safeParse({ ...valid, beneficiaryDocument: "00000000000000" }).success, false);
  assert.equal(inboxBarcodePaymentPreparationSchema.safeParse({ ...valid, beneficiaryDocument: "52998224725" }).success, false);
  assert.equal(inboxBarcodePaymentPreparationSchema.safeParse({ ...valid, scheduledFor: "2026-02-30" }).success, false);
  assert.equal(inboxBarcodePaymentPreparationSchema.safeParse({ ...valid, unexpected: true }).success, false);
});
