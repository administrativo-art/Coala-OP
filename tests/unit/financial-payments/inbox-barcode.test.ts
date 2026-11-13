import assert from "node:assert/strict";
import test from "node:test";

import { governmentCollectionBarcode, inboxBarcodePaymentPreparationSchema, validatedCollectionBarcode } from "../../../src/features/financial/payment-requests/inbox-barcode";

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

// DARF real de 10/2026 (CT Sorvetes, R$ 1.049,99), já público na guia recebida.
const darf = "858900000107499903852637230716263100518788193907";

test("CNPJ do favorecido é opcional no schema; o serviço decide pelo tipo de guia", () => {
  const { beneficiaryDocument: _omitted, ...withoutDocument } = valid;
  assert.equal(inboxBarcodePaymentPreparationSchema.parse(withoutDocument).beneficiaryDocument, undefined);
  assert.equal(inboxBarcodePaymentPreparationSchema.safeParse({ ...withoutDocument, beneficiaryDocument: "" }).success, false);
});

test("reconhece guia pública íntegra e extrai o valor efetivo", () => {
  assert.deepEqual(governmentCollectionBarcode(darf), {
    barcode: "85890000010499903852632307162631051878819390",
    amountCents: 104999,
  });
  assert.deepEqual(governmentCollectionBarcode("85890000010 7 49990385263 7 23071626310 0 51878819390 7"), governmentCollectionBarcode(darf));
  assert.equal(governmentCollectionBarcode("85890000010499903852632307162631051878819390")?.amountCents, 104999);
});

test("recusa guia alterada, de outro segmento ou boleto bancário", () => {
  assert.equal(governmentCollectionBarcode(`${darf.slice(0, -1)}8`), null);
  assert.equal(governmentCollectionBarcode(`${darf.slice(0, 11)}8${darf.slice(12)}`), null);
  assert.equal(governmentCollectionBarcode(`84${darf.slice(2)}`), null);
  assert.equal(governmentCollectionBarcode("1".repeat(47)), null);
  assert.equal(governmentCollectionBarcode(""), null);
});

test("valida a linha de arrecadação da fatura de telefonia e seu valor", () => {
  const vivo = "846800000008408900740015104618553796112602611256";
  assert.deepEqual(validatedCollectionBarcode(vivo), {
    barcode: "84680000000408900740011046185537911260261125",
    segment: "4",
    amountCents: 4089,
  });
  assert.equal(validatedCollectionBarcode(`${vivo.slice(0, -1)}7`), null);
  assert.equal(governmentCollectionBarcode(vivo), null);
});
