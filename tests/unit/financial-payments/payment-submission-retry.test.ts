import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateCorrectedPaymentRequest,
  canRetryDefinitivelyRejectedPayment,
  hasFreshClearBankPreflight,
  paymentSubmissionAttemptCount,
} from "../../../src/features/financial/payment-requests/submission-retry";

const rejected = {
  status: "failed",
  submissionStartedAt: "2026-10-07T01:07:54.261Z",
  lastError: { code: "INTER_HTTP_400" },
};

test("permite uma única retomada após rejeição HTTP 400 sem ID bancário", () => {
  assert.equal(paymentSubmissionAttemptCount(rejected), 1);
  assert.equal(canRetryDefinitivelyRejectedPayment(rejected), true);
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, submissionAttemptCount: 2 }), false);
});

test("pré-validação bancária clara só pode ser reaproveitada por cinco minutos", () => {
  const now = Date.parse("2026-10-24T13:00:00.000Z");
  assert.equal(hasFreshClearBankPreflight({
    bankPreflight: { outcome: "clear", checkedAt: "2026-10-24T12:56:00.000Z" },
  }, now), true);
  assert.equal(hasFreshClearBankPreflight({
    bankPreflight: { outcome: "clear", checkedAt: "2026-10-24T12:54:59.999Z" },
  }, now), false);
  assert.equal(hasFreshClearBankPreflight({
    bankPreflight: { outcome: "existing_recovered", checkedAt: "2026-10-24T12:59:00.000Z" },
  }, now), false);
});

test("após duas recusas exige nova versão da cobrança em vez de novo POST no mesmo registro", () => {
  const exhausted = {
    ...rejected,
    sourceType: "financial_inbox",
    paymentRail: "barcode",
    submissionAttemptCount: 2,
  };
  assert.equal(canRetryDefinitivelyRejectedPayment(exhausted), false);
  assert.equal(canCreateCorrectedPaymentRequest(exhausted), true);
  assert.equal(canCreateCorrectedPaymentRequest({ ...exhausted, interRequestId: "bank_1" }), false);
  assert.equal(canCreateCorrectedPaymentRequest({ ...exhausted, supersededByPaymentRequestId: "request_v3" }), false);
  assert.equal(canCreateCorrectedPaymentRequest({ ...exhausted, sourceType: "expense_boleto" }), false);
});

test("bloqueia retomada de resultado ambíguo ou já identificado no banco", () => {
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, lastError: { code: "INTER_REQUEST_FAILED" } }), false);
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, interRequestId: "bank_1" }), false);
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, status: "ready_to_submit" }), false);
});
