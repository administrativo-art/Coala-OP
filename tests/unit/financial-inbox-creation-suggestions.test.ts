import assert from "node:assert/strict";
import test from "node:test";

import { chooseCreationSuggestion } from "../../src/features/financial/inbox/creation-suggestions";
import type { FinancialInboxClassification, FinancialInboxExpenseSuggestion, FinancialInboxProvisionSuggestion } from "../../src/features/financial/inbox/types";

const noExpense: FinancialInboxExpenseSuggestion = {
  status: "not_found",
  expenseId: null,
  installmentNumber: null,
  installmentTotal: null,
  description: null,
  supplier: null,
  amountCents: null,
  dueDate: null,
  reasons: [],
  paymentState: null,
  existingBankPayment: null,
  existingSettlement: null,
  alternatives: [],
};
const noProvision: FinancialInboxProvisionSuggestion = {
  status: "not_found",
  provisionExpenseId: null,
  confidence: null,
  score: null,
  reasons: [],
  description: null,
  supplier: null,
  competence: null,
  dueDate: null,
  provisionedAmountCents: null,
  checkedAt: null,
};

function telecom(overrides: Partial<FinancialInboxClassification> = {}): FinancialInboxClassification {
  return {
    documentType: "utility_bill",
    financeLikely: true,
    confidence: "high",
    supplierName: "Vivo",
    competence: "2026-08",
    dueDate: "2026-09-15",
    amountCents: 24990,
    barcode: null,
    barcodeMasked: null,
    links: [],
    billingIdentity: {
      supplierTaxId: null,
      customerAccount: null,
      contractNumber: null,
      serviceType: "mobile",
      serviceNumbers: ["+5598999991234"],
    },
    ...overrides,
  };
}

test("sugere criação preenchida quando não existe correspondência", () => {
  const suggestion = chooseCreationSuggestion({
    subject: "Fatura Vivo móvel",
    classification: telecom(),
    existingExpenseSuggestion: noExpense,
    provisionSuggestion: noProvision,
  });
  assert.equal(suggestion.status, "suggested");
  assert.deepEqual(suggestion.missingFields, []);
});

test("exige o número da linha antes de sugerir nova conta telefônica", () => {
  const suggestion = chooseCreationSuggestion({
    subject: "Fatura Vivo móvel",
    classification: telecom({
      billingIdentity: {
        supplierTaxId: null,
        customerAccount: "123456",
        contractNumber: "ABC123",
        serviceType: "mobile",
        serviceNumbers: [],
      },
    }),
    existingExpenseSuggestion: noExpense,
    provisionSuggestion: noProvision,
  });
  assert.equal(suggestion.status, "incomplete");
  assert.ok(suggestion.missingFields.includes("número da linha"));
});
