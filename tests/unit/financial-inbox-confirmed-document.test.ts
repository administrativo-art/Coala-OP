import assert from "node:assert/strict";
import test from "node:test";

import {
  assertConfirmedExistingExpense,
  confirmFinancialInboxDocument,
  supplierNamesAreCompatible,
  telecomBillingIdentitiesMatch,
} from "../../src/features/financial/inbox/confirmed-document";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

const BARCODE = "10491158171700010004400014406375415900000146798";
const VIVO_COLLECTION_LINE = "846800000008408900740015104618553796112602611256";
const GOVERNMENT_COLLECTION_LINE = "858900000107499903852637230716263100518788193907";

test("identidade de telecom exige conta e linha coincidentes para previsão legada", () => {
  const confirmed = { supplierTaxId: "02558157000405", customerAccount: "0461855379",
    contractNumber: null, serviceType: "mobile" as const, serviceNumbers: ["+5598999072739"] };
  const forecast = { ...confirmed, customerAccount: "046.185.537-9", serviceNumbers: ["98-99907-2739"] };
  assert.equal(telecomBillingIdentitiesMatch(confirmed, forecast), true);
  assert.equal(telecomBillingIdentitiesMatch(confirmed, { ...forecast, customerAccount: "0461855378" }), false);
  assert.equal(telecomBillingIdentitiesMatch(confirmed, { ...forecast, serviceNumbers: ["+5598999072740"] }), false);
  assert.equal(telecomBillingIdentitiesMatch(confirmed, { ...forecast, serviceNumbers: [] }), false);
});

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

test("guia pública aceita arrecadador sem CNPJ só com identidade fiscal e valor codificado", () => {
  const input = {
    amountCents: 104_999, dueDate: "2026-11-23", competence: "2026-10",
    barcode: GOVERNMENT_COLLECTION_LINE, supplierName: "Receita Federal", supplierTaxId: null,
    fiscalIdentity: { documentKind: "das" as const, collectorName: "Receita Federal",
      taxpayerName: "CT Sorvetes", taxpayerTaxId: "05.695.860/0001-00" },
  };
  const current = classification({ documentType: "other", supplierName: null, dueDate: null, amountCents: null });
  const result = confirmFinancialInboxDocument(current, input);
  assert.equal(result.documentType, "tax");
  assert.equal(result.billingIdentity?.supplierTaxId, null);
  assert.equal(result.fiscalIdentity?.documentKind, "das");
  assert.equal(result.fiscalIdentity?.taxpayerTaxId, "05695860000100");
  assert.throws(() => confirmFinancialInboxDocument(current, { ...input, fiscalIdentity: undefined }), /CNPJ válido/);
  assert.throws(() => confirmFinancialInboxDocument(current, { ...input, barcode: `${GOVERNMENT_COLLECTION_LINE.slice(0, -1)}8` }), /linha digitável não é válida/);
  assert.throws(() => confirmFinancialInboxDocument(current, { ...input, fiscalIdentity: { ...input.fiscalIdentity, taxpayerTaxId: "11111111111111" } }), /contribuinte/);
});

test("vínculo de guia a despesa real exige valor, competência, centro, rateio e parcela sem pagamento", () => {
  const document = { amountCents: 104_999, dueDate: "2026-11-23", competence: "2026-10",
    barcode: GOVERNMENT_COLLECTION_LINE, supplierName: "Receita Federal", supplierTaxId: null };
  const accounting = { accountPlanId: "dare-icms-antecipado", resultCenterId: "renascenca",
    apportionments: [
      { resultCenter: "Tirirical", percentage: 33.34 },
      { resultCenter: "João Paulo", percentage: 33.33 },
      { resultCenter: "Shopping", percentage: 33.33 },
    ] };
  const expense = { id: "expense-1", status: "pending", provisionType: "actual", accountPlan: accounting.accountPlanId,
    isApportioned: true, referenceResultCenterId: accounting.resultCenterId, apportionments: accounting.apportionments,
    totalValue: 1049.99, dueDate: "2026-11-23T12:00:00.000Z", competenceDate: "2026-10-01T12:00:00.000Z",
    installments: [{ number: 1, status: "pending", value: 1049.99, dueDate: "2026-11-23T12:00:00.000Z" }] };
  assert.doesNotThrow(() => assertConfirmedExistingExpense(expense, "inbox-1", document, accounting));
  assert.throws(() => assertConfirmedExistingExpense({ ...expense, totalValue: 1049.98 }, "inbox-1", document, accounting), /Valor/);
  assert.throws(() => assertConfirmedExistingExpense({ ...expense, apportionments: [{ resultCenter: "Tirirical", percentage: 100 }] }, "inbox-1", document, accounting), /rateio/);
  assert.throws(() => assertConfirmedExistingExpense({ ...expense, installments: [{ ...expense.installments[0], bankPaymentTransactionId: "bank-1" }] }, "inbox-1", document, accounting), /parcela/);
  assert.throws(() => assertConfirmedExistingExpense({ ...expense, financialInboxMessageId: "inbox-2" }, "inbox-1", document, accounting), /tratamento financeiro/);
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
