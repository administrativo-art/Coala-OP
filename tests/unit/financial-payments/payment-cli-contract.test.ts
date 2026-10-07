import assert from "node:assert/strict";
import test from "node:test";

import { validatePaymentCliAction, validatePaymentCliPreparation } from "../../../scripts/financial/payment-cli-contract";

const order = {
  sourceType: "financial_inbox", paymentRail: "barcode", sourceId: "inbox_1", expenseId: "expense_1",
  amount: 1066.8, status: "awaiting_financial_authorization",
  barcodeSnapshot: { code: "1".repeat(47), scheduledFor: "2026-09-30", beneficiaryDocument: "12345678000195" },
};
const expected = { amountCents: 106680, scheduledFor: "2026-09-30", beneficiaryDocument: "12345678000195",
  expenseId: "expense_1", barcode: order.barcodeSnapshot.code };

test("autoriza somente a cobrança específica validada", () => {
  assert.doesNotThrow(() => validatePaymentCliAction({ request: order, action: "authorize", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: order, action: "send", ...expected }));
  assert.doesNotThrow(() => validatePaymentCliAction({ request: { ...order, status: "ready_to_submit" }, action: "send", ...expected }));
});

test("boleto direto exige origem na própria despesa e preserva todas as confirmações", () => {
  const direct = { ...order, sourceType: "expense_boleto", sourceId: "expense_1" };
  assert.doesNotThrow(() => validatePaymentCliAction({ request: direct, action: "authorize", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: { ...direct, sourceId: "other" }, action: "authorize", ...expected }));
});

test("impede divergência e repetição de ordem bancária", () => {
  assert.throws(() => validatePaymentCliAction({ request: order, action: "authorize", ...expected, amountCents: 106681 }));
  assert.throws(() => validatePaymentCliAction({ request: order, action: "authorize", ...expected, expenseId: "expense_2" }));
  assert.throws(() => validatePaymentCliAction({ request: order, action: "authorize", ...expected, barcode: "12345678" }));
  assert.throws(() => validatePaymentCliAction({ request: order, action: "authorize", ...expected, barcode: `999${expected.barcode.slice(3)}` }));
  assert.throws(() => validatePaymentCliAction({ request: { ...order, barcodeSnapshot: { ...order.barcodeSnapshot, beneficiaryDocument: null } }, action: "authorize", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: { ...order, interRequestId: "bank_1" }, action: "authorize", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: { ...order, status: "ready_to_submit", submissionStartedAt: "2026-09-24T00:00:00Z" }, action: "send", ...expected }));
});

test("retoma uma única vez somente rejeição HTTP 400 confirmada", () => {
  const failed = {
    ...order,
    status: "failed",
    submissionStartedAt: "2026-10-07T01:07:54.261Z",
    lastError: { code: "INTER_HTTP_400" },
  };
  assert.doesNotThrow(() => validatePaymentCliAction({ request: failed, action: "retry-send", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: { ...failed, submissionAttemptCount: 2 }, action: "retry-send", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: { ...failed, lastError: { code: "INTER_REQUEST_FAILED" } }, action: "retry-send", ...expected }));
  assert.throws(() => validatePaymentCliAction({ request: { ...failed, interRequestId: "bank_1" }, action: "retry-send", ...expected }));
});

test("recusa datas impossíveis, ações desconhecidas e estados posteriores", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-09-31"]) {
    assert.throws(() => validatePaymentCliAction({ request: { ...order, barcodeSnapshot: { ...order.barcodeSnapshot, scheduledFor: date } }, action: "authorize", ...expected, scheduledFor: date }));
  }
  assert.throws(() => validatePaymentCliAction({ request: order, ...expected, action: "approve" as "authorize" }));
  for (const status of ["failed", "submitting", "awaiting_bank_approval", "scheduled", "paid"]) {
    assert.throws(() => validatePaymentCliAction({ request: { ...order, status }, action: "send", ...expected }));
  }
  assert.throws(() => validatePaymentCliAction({ request: { ...order, paymentRail: "pix" }, action: "authorize", ...expected }));
});

test("prepara somente a cobrança vinculada sem ordem ou pagamento anterior", () => {
  const input = {
    message: {
      id: "inbox_123", status: "linked", linkedExpenseId: "expense_1", paymentRequestId: null,
      classification: { amountCents: 106680, dueDate: "2026-09-30", barcode: expected.barcode },
      existingBankPayment: null, existingSettlement: null,
    },
    inboxMessageId: "inbox_123", ...expected,
  };
  assert.doesNotThrow(() => validatePaymentCliPreparation(input));
  assert.throws(() => validatePaymentCliPreparation({ ...input, message: { ...input.message, paymentRequestId: "request_1" } }));
  assert.throws(() => validatePaymentCliPreparation({ ...input, message: { ...input.message, linkedExpenseId: "expense_2" } }));
  assert.throws(() => validatePaymentCliPreparation({ ...input, beneficiaryDocument: "00000000000000" }));
  assert.throws(() => validatePaymentCliPreparation({ ...input, barcode: `9${expected.barcode.slice(1)}` }));
});
