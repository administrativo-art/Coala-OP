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

test("linha digitável idêntica identifica o mesmo boleto apesar da variação no nome", () => {
  const barcode = "23793493079001004992396000130003915620000113884";
  const suggestion = chooseExistingExpenseSuggestion({
    ...classification,
    supplierName: "Nome abreviado sem equivalência textual",
    barcode,
    barcodeMasked: null,
  }, [marviExpense({
    supplier: "Marvi Alimentos",
    installments: [{
      number: 1,
      value: 1138.84,
      dueDate: "2026-09-07",
      status: "pending",
      bankLine: "23793.49307 90010.049923 96000.130003 9 15620000113884",
    }],
  })]);

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.matchStrength, "document");
  assert.equal(suggestion.automaticLinkEligible, true);
  assert.deepEqual(suggestion.automaticLinkReasons, ["linha digitável/código de barras idêntico"]);
  assert.match(suggestion.reasons.join(" "), /mesmo boleto/);
  assert.match(suggestion.matchedBarcodeMasked || "", /^23793.*13884$/);
});

test("linha digitável idêntica basta mesmo quando o e-mail não informa valor, vencimento ou fornecedor", () => {
  const barcode = "23793493079001004992396000130003915620000113884";
  const suggestion = chooseExistingExpenseSuggestion({
    ...classification,
    supplierName: null,
    dueDate: null,
    amountCents: null,
    barcode,
  }, [marviExpense({
    installments: [{
      number: 1,
      value: 1138.84,
      dueDate: "2026-09-07",
      status: "pending",
      bankLine: barcode,
    }],
  })]);

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.expenseId, "expense-nfe-872460-marvi-20260817");
  assert.equal(suggestion.automaticLinkEligible, true);
});

test("boleto bancário já registrado aponta somente para sua parcela", () => {
  const barcode = "23793493079001004992396000130003915620000113884";
  const barcodeOnly = {
    ...classification,
    supplierName: null,
    dueDate: null,
    amountCents: null,
    barcode,
  };
  const payment = {
    transactionId: "inter-request-1",
    bankStatus: null,
    schedulingStatus: "awaiting_approval",
    scheduledFor: "2026-09-07",
  };
  const exact = chooseExistingExpenseSuggestion(barcodeOnly, [marviExpense({
    bankPaymentEvidence: [{ installmentNumber: 1, code: barcode, payment }],
  })]);
  assert.equal(exact.status, "suggested");
  assert.equal(exact.installmentNumber, 1);
  assert.equal(exact.automaticLinkEligible, true);

  const legacyWithoutInstallment = chooseExistingExpenseSuggestion(barcodeOnly, [marviExpense({
    bankPaymentEvidence: [{ installmentNumber: null, code: barcode, payment }],
  })]);
  assert.equal(legacyWithoutInstallment.status, "not_found");
  assert.equal(legacyWithoutInstallment.automaticLinkEligible, false);
});

test("número da NF reforça valor e vencimento quando o boleto não foi extraído", () => {
  const suggestion = chooseExistingExpenseSuggestion({
    ...classification,
    supplierName: "Nome comercial diferente",
    documentReferences: ["872460"],
  }, [marviExpense()]);

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.matchStrength, "document");
  assert.equal(suggestion.automaticLinkEligible, false);
  assert.deepEqual(suggestion.matchedDocumentReferences, ["872460"]);
  assert.match(suggestion.reasons.join(" "), /mesmo documento\/NF 872460/);
});

test("libera automação composta somente com CNPJ, documento, parcela, valor e vencimento", () => {
  const strong = chooseExistingExpenseSuggestion({
    ...classification,
    documentReferences: ["872460"],
    installmentNumber: 1,
    installmentTotal: 3,
    billingIdentity: {
      supplierTaxId: "53408654000115",
      customerAccount: null,
      contractNumber: null,
      serviceType: "other",
      serviceNumbers: [],
    },
  }, [marviExpense({
    billingIdentity: {
      supplierTaxId: "53408654000115",
      customerAccount: null,
      contractNumber: null,
      serviceType: "other",
      serviceNumbers: [],
    },
  })]);
  assert.equal(strong.status, "suggested");
  assert.equal(strong.automaticLinkEligible, true);
  assert.deepEqual(strong.automaticLinkReasons, ["CNPJ, NF/documento, parcela, valor e vencimento idênticos"]);

  const wrongInstallment = chooseExistingExpenseSuggestion({
    ...classification,
    documentReferences: ["872460"],
    installmentNumber: 2,
    installmentTotal: 3,
    billingIdentity: {
      supplierTaxId: "53408654000115",
      customerAccount: null,
      contractNumber: null,
      serviceType: "other",
      serviceNumbers: [],
    },
  }, [marviExpense({
    billingIdentity: {
      supplierTaxId: "53408654000115",
      customerAccount: null,
      contractNumber: null,
      serviceType: "other",
      serviceNumbers: [],
    },
  })]);
  assert.equal(wrongInstallment.status, "suggested");
  assert.equal(wrongInstallment.automaticLinkEligible, false);
});

test("telefonia exige a mesma linha para sugerir automaticamente", () => {
  const telecomClassification: FinancialInboxClassification = {
    ...classification,
    documentType: "utility_bill",
    supplierName: "Vivo",
    billingIdentity: {
      supplierTaxId: null,
      customerAccount: null,
      contractNumber: null,
      serviceType: "mobile",
      serviceNumbers: ["+5598999991234"],
    },
  };
  const correct = marviExpense({
    id: "vivo-correct",
    supplier: "Telefônica Brasil S.A.",
    description: "Telefonia móvel · Linha (98) 99999-1234",
  });
  const wrong = marviExpense({
    id: "vivo-wrong",
    supplier: "Vivo",
    description: "Telefonia móvel · Linha (98) 98888-4321",
  });

  const exact = chooseExistingExpenseSuggestion(telecomClassification, [correct]);
  assert.equal(exact.status, "suggested");
  assert.match(exact.reasons.join(" "), /linha telefônica/);

  const rejected = chooseExistingExpenseSuggestion(telecomClassification, [wrong]);
  assert.equal(rejected.status, "not_found");
  assert.equal(rejected.alternatives?.[0]?.expenseId, "vivo-wrong");

  const accountOnly = chooseExistingExpenseSuggestion({
    ...telecomClassification,
    billingIdentity: {
      ...telecomClassification.billingIdentity!,
      customerAccount: "123456",
      serviceNumbers: [],
    },
  }, [marviExpense({
    id: "vivo-account-only",
    supplier: "Vivo",
    description: "Telefonia móvel · Conta 123456",
  })]);
  assert.equal(accountOnly.status, "not_found");
});
