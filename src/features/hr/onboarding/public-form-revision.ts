type FormRecord = Record<string, unknown>;

export type OnboardingIdentityField = 'fullName' | 'cpf';

function asPositiveInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as FormRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function publicFormAnswersEqual(previous: FormRecord, next: FormRecord) {
  return JSON.stringify(canonicalize(previous)) === JSON.stringify(canonicalize(next));
}

export function changedIdentityFields(previous: FormRecord, next: FormRecord): OnboardingIdentityField[] {
  const changed: OnboardingIdentityField[] = [];
  if (String(previous.fullName ?? '') !== String(next.fullName ?? '')) changed.push('fullName');
  if (String(previous.cpf ?? '').replace(/\D/g, '') !== String(next.cpf ?? '').replace(/\D/g, '')) changed.push('cpf');
  return changed;
}

export function nextPublicFormRevision(params: {
  currentRevision: unknown;
  hasPreviousSubmission: boolean;
  answersChanged: boolean;
}) {
  const current = asPositiveInteger(params.currentRevision);
  if (!params.hasPreviousSubmission) return current ?? 1;
  if (!params.answersChanged) return current ?? 1;
  return (current ?? 1) + 1;
}

export function formDataValidationIsCurrent(params: {
  publicFormRevision?: unknown;
  publicFormLastSubmittedAt?: unknown;
  publicFormSubmittedAt?: unknown;
  validationRevision?: unknown;
  validationSubmissionAt?: unknown;
  schedulingEmailSentAt?: unknown;
}) {
  if (typeof params.schedulingEmailSentAt === 'string' && params.schedulingEmailSentAt.trim()) return true;

  const publicRevision = asPositiveInteger(params.publicFormRevision);
  const validationRevision = asPositiveInteger(params.validationRevision);
  if (publicRevision !== null && validationRevision !== null) return publicRevision === validationRevision;

  const submissionMarker = typeof params.publicFormLastSubmittedAt === 'string' && params.publicFormLastSubmittedAt.trim()
    ? params.publicFormLastSubmittedAt
    : typeof params.publicFormSubmittedAt === 'string'
      ? params.publicFormSubmittedAt
      : '';
  return Boolean(submissionMarker && params.validationSubmissionAt === submissionMarker);
}
