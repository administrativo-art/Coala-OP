import type { OnboardingProcess } from '@/types';

export type AsoPaymentStatus = NonNullable<OnboardingProcess['asoWorkflow']>['paymentStatus'];

const ACTIVE_ASO_PAYMENT_STATUSES = new Set<AsoPaymentStatus>([
  'awaiting_financial_authorization',
  'ready_to_submit',
  'submitting',
  'awaiting_bank_approval',
  'processing',
]);

export function shouldPollAsoPayment(paymentRequestId?: string | null, status?: AsoPaymentStatus) {
  return Boolean(paymentRequestId && ACTIVE_ASO_PAYMENT_STATUSES.has(status));
}
