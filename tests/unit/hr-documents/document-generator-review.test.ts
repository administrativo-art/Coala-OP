import assert from "node:assert/strict";
import test from "node:test";

import { RECEIPT_FORM_SCHEMA } from "../../../src/features/hr/documents/document-form-schema";
import { changeCurrencyInput, currencyDisplay, editCurrency, formatBrl, isCurrentPreviewResponse, missingGeneratorFields, parseBrl, reviewActions, type CurrencyEdit } from "../../../src/components/documents/document-generator-review";

test("valor de item aceita entrada brasileira e mantém número decimal para o payload", () => {
  assert.equal(parseBrl("R$ 1.234,56"), 1234.56);
  assert.equal(parseBrl("1.234"), 1234);
  assert.equal(parseBrl("1.234,56"), 1234.56);
  assert.equal(formatBrl(parseBrl("R$ 1.234,56")), "R$ 1.234,56");
  assert.equal(parseBrl(""), "");
  let edit: CurrencyEdit = { display: "", amount: "", caret: 0 };
  for (const [key, expectedDisplay, expectedAmount] of [
    ["1", "R$ 1,00", 1], ["0", "R$ 10,00", 10], ["0", "R$ 100,00", 100], ["0", "R$ 1.000,00", 1000],
  ] as const) {
    edit = editCurrency(edit.display, key, edit.caret);
    assert.equal(edit.display, expectedDisplay);
    assert.equal(edit.amount, expectedAmount);
  }
  edit = editCurrency(edit.display, ",", edit.caret);
  assert.equal(edit.selectionEnd, edit.display.length);
  edit = editCurrency(edit.display, "5", edit.caret, edit.selectionEnd);
  edit = editCurrency(edit.display, "6", edit.caret);
  assert.equal(edit.display, "R$ 1.000,56");
  assert.equal(edit.amount, 1000.56);
  assert.equal(currencyDisplay(parseBrl("1.234,56")), "R$ 1.234,56");
  edit = editCurrency("R$ 1,00", "Backspace", 4);
  assert.equal(edit.amount, "");
  assert.equal(editCurrency("R$ 1.000,56", "2", 0, "R$ 1.000,56".length).display, "R$ 2,00");
});

test("entrada nativa sem keydown conserva centenas, milhar e edição dos centavos", () => {
  assert.equal(changeCurrencyInput("", "1", 1).display, "R$ 1,00");
  assert.equal(changeCurrencyInput("R$ 100,00", "R$ 1000,00", 7).display, "R$ 1.000,00");
  const decimal = changeCurrencyInput("R$ 100,00", "R$ 100,,00", 7);
  assert.equal(decimal.amount, 100);
  assert.equal(decimal.selectionEnd, decimal.display.length);
  const first = changeCurrencyInput(decimal.display, "R$ 100,5", 8);
  assert.equal(first.display, "R$ 100,50");
  assert.equal(first.caret, 8);
  assert.equal(changeCurrencyInput(first.display, "R$ 100,560", 9).display, "R$ 100,56");
  assert.equal(changeCurrencyInput("R$ 1,00", "R$ ,00", 3).amount, "");
});

test("revisão mostra obrigatórios do schema, inclusive item e e-mail", () => {
  const missing = missingGeneratorFields(RECEIPT_FORM_SCHEMA, {
    receipt: {
      issuer: { partyType: "company", snapshot: { name: "Coala", email: "inválido" } },
      items: [{ name: "Serviço", value: "" }],
    },
  });
  assert.ok(missing.includes("Emitente: e-mail para assinatura"));
  assert.ok(missing.includes("Itens do recibo 1: Valor"));
  assert.ok(missing.includes("Recebedor"));
  assert.ok(missingGeneratorFields(RECEIPT_FORM_SCHEMA, { receipt: { items: [{ name: "   ", value: 10 }], city: "   " } }).includes("Itens do recibo 1: Item"));
});

test("prévia anterior perde validade após edição; aprovação requer PDF e revisão", () => {
  const requestRevision = 2;
  assert.equal(isCurrentPreviewResponse(requestRevision, requestRevision + 1), false);
  assert.equal(isCurrentPreviewResponse(requestRevision, requestRevision), true);
  assert.deepEqual(reviewActions({ pdfAvailable: false, missingRequired: [], status: "review_pending", canReview: true }), { canApprove: false, canStart: false });
  assert.deepEqual(reviewActions({ pdfAvailable: true, missingRequired: ["Valor"], status: "review_pending", canReview: true }), { canApprove: false, canStart: false });
  assert.deepEqual(reviewActions({ pdfAvailable: true, missingRequired: [], status: "review_pending", canReview: false }), { canApprove: false, canStart: false });
  assert.deepEqual(reviewActions({ pdfAvailable: true, missingRequired: [], status: "review_pending", canReview: true }), { canApprove: true, canStart: false });
  assert.deepEqual(reviewActions({ pdfAvailable: true, missingRequired: [], status: "approved", canReview: true }), { canApprove: false, canStart: true });
  assert.deepEqual(reviewActions({ pdfAvailable: true, missingRequired: [], status: "final", canReview: true }), { canApprove: false, canStart: true });
});
