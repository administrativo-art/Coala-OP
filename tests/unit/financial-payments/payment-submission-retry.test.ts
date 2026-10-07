import assert from "node:assert/strict";
import test from "node:test";

import {
  canRetryDefinitivelyRejectedPayment,
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

test("bloqueia retomada de resultado ambíguo ou já identificado no banco", () => {
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, lastError: { code: "INTER_REQUEST_FAILED" } }), false);
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, interRequestId: "bank_1" }), false);
  assert.equal(canRetryDefinitivelyRejectedPayment({ ...rejected, status: "ready_to_submit" }), false);
});
