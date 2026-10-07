export type PaymentSubmissionRetrySnapshot = {
  status?: string | null;
  interRequestId?: string | null;
  submissionStartedAt?: string | null;
  submissionAttemptCount?: number | null;
  lastError?: { code?: string | null } | null;
};

export function paymentSubmissionAttemptCount(input: PaymentSubmissionRetrySnapshot) {
  const stored = Number(input.submissionAttemptCount);
  if (Number.isSafeInteger(stored) && stored >= 0) return stored;
  return input.submissionStartedAt ? 1 : 0;
}

/**
 * A single retry is allowed only after a definitive request rejection. HTTP
 * 400 cannot represent an accepted payment, and the retry still performs the
 * bank lookup before issuing another POST. Ambiguous and transient failures
 * remain blocked for manual reconciliation.
 */
export function canRetryDefinitivelyRejectedPayment(input: PaymentSubmissionRetrySnapshot) {
  return input.status === "failed"
    && !input.interRequestId
    && Boolean(input.submissionStartedAt)
    && input.lastError?.code === "INTER_HTTP_400"
    && paymentSubmissionAttemptCount(input) === 1;
}
