import type { OnboardingProcess } from '@/types';

export const ONBOARDING_CANCELLATION_REASON_MIN_LENGTH = 10;
export const ONBOARDING_CANCELLATION_REASON_MAX_LENGTH = 2000;

export function normalizeOnboardingCancellationReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (reason.length < ONBOARDING_CANCELLATION_REASON_MIN_LENGTH) return null;
  return reason.slice(0, ONBOARDING_CANCELLATION_REASON_MAX_LENGTH);
}

export function normalizeOnboardingDateOnly(value: unknown) {
  if (typeof value !== 'string') return null;
  const dateOnly = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOnly) return null;
  return dateOnly;
}

export function canUpdateExpectedAdmissionDate(
  process: Pick<OnboardingProcess, 'status' | 'currentStage'>
) {
  if (process.status === 'completed' || process.status === 'cancelled') return false;
  return ['documents', 'document_review'].includes(process.currentStage ?? 'documents');
}
