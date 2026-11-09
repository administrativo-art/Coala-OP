import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmFinancialInboxDocument,
  supplierNamesAreCompatible,
} from "../../src/features/financial/inbox/confirmed-document";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

const BARCODE = "10491158171700010004400014406375415900000146798";
const VIVO_COLLECTION_LINE = "846800000008408900740015104618553796112602611256";

function classification(overrides: Partial<FinancialInboxClassification> = {}): FinancialInboxClassification {
  return {
    documentType: "charge",
    financeLikely: true,
    confidence: "medium",
    supplierName: "Supplymidia",
    competence: null,
    dueDate: "2026-10-05",
    amountCents: 146_798,
    barcode: null,
    barcodeMasked: null,
    links: [],
    billingIdentity: null,
    fiscalIdentity: null,
    ...overrides,
  };
}

const confirmation = {
  amountCents: 146_798,
  dueDate: "2026-10-05",
  competence: "2026-09",
  barcode: BARCODE,
  supplierName: "OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA",
  supplierTaxId: "05.695.860/0001-00",
};

test("confirma campos ausentes sem alterar valor e vencimento já observados", () => {
  const result = confirmFinancialInboxDocument(classification(), confirmation);

  assert.equal(result.amountCents, 146_798);
  assert.equal(result.dueDate, "2026-10-05");
  assert.equal(result.competence, "2026-09");
  assert.equal(result.barcode, BARCODE);
  assert.equal(result.supplierName, "OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA");
  assert.equal(result.billingIdentity?.supplierTaxId, "05695860000100");
  assert.equal(result.confidence, "high");
});

test("confirma conta Vivo de 48 dígitos com valor, conta e linha íntegros", () => {
  const result = confirmFinancialInboxDocument(classification({
    documentType: "utility_bill",
    supplierName: "Vivo",
    dueDate: null,
    amountCents: null,
    billingIdentity: { supplierTaxId: null, customerAccount: null, contractNumber: null,
      serviceType: "mobile", serviceNumbers: [] },
  }), {
    amountCents: 4089, dueDate: "2026-11-25", competence: "2026-11",
    barcode: VIVO_COLLECTION_LINE, supplierName: "Vivo", supplierTaxId: "02.558.157/0004-05",
    customerAccount: "0461855379", serviceNumbers: ["98-99907-2739"], serviceType: "mobile",
  });
  assert.equal(result.barcode, VIVO_COLLECTION_LINE);
  assert.equal(result.billingIdentity?.customerAccount, "0461855379");
  assert.equal(result.billingIdentity?.serviceType, "mobile");
  assert.deepEqual(result.billingIdentity?.serviceNumbers, ["+5598999072739"]);
  assert.throws(() => confirmFinancialInboxDocument(classification({ dueDate: null, amountCents: null }), {
    ...confirmation, amountCents: 4089, dueDate: "2026-11-25", barcode: `${VIVO_COLLECTION_LINE.slice(0, -1)}7`,
  }), /linha digitável não é válida/);
});

test("recusa linha digitável cujo principal não corresponde ao valor confirmado", () => {
  assert.throws(
    () => confirmFinancialInboxDocument(classification(), { ...confirmation, amountCents: 146_799 }),
    /linha digitável não é válida ou não corresponde ao valor principal/,
  );
});

test("recusa divergência com valor, vencimento, competência ou linha já observados", () => {
  assert.throws(
    () => confirmFinancialInboxDocument(classification({ amountCents: 100 }), confirmation),
    /valor confirmado diverge/,
  );
  assert.throws(
    () => confirmFinancialInboxDocument(classification({ dueDate: "2026-10-04" }), confirmation),
    /vencimento confirmado diverge/,
  );
  assert.throws(
    () => confirmFinancialInboxDocument(classification({ competence: "2026-08" }), confirmation),
    /competência confirmada diverge/,
  );
  assert.throws(
    () => confirmFinancialInboxDocument(classification({ barcode: `${BARCODE.slice(0, -1)}9` }), confirmation),
    /linha digitável confirmada diverge|linha digitável não é válida/,
  );
});

test("recusa CNPJ inválido ou divergente do documento analisado", () => {
  assert.throws(
    () => confirmFinancialInboxDocument(classification(), { ...confirmation, supplierTaxId: "11111111111111" }),
    /CNPJ válido/,
  );
  assert.throws(
    () => confirmFinancialInboxDocument(classification({
      billingIdentity: {
        supplierTaxId: "64433090000197",
        customerAccount: null,
        contractNumber: null,
        serviceType: null,
        serviceNumbers: [],
      },
    }), confirmation),
    /CNPJ confirmado diverge/,
  );
});

test("compara o fornecedor confirmado com a razão social da previsão", () => {
  assert.equal(
    supplierNamesAreCompatible("OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA", "Oceanos Investimentos Imobiliários"),
    true,
  );
  assert.equal(supplierNamesAreCompatible("Oceanos Investimentos", "Supplymidia"), false);
});
