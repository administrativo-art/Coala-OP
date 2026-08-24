export type PublicImageVoiceConsentDecision = {
  authorized?: boolean;
  status?: string | null;
  termVersion?: string | null;
  termHash?: string | null;
  revokedAt?: string | null;
} | null;

export type PublicImageVoiceConsentTermIdentity = {
  version?: string | null;
  hash?: string | null;
} | null;

export function shouldRestoreImageVoiceAuthorization(
  decision: PublicImageVoiceConsentDecision | undefined,
  currentTerm: PublicImageVoiceConsentTermIdentity | undefined,
) {
  if (!decision || !currentTerm) return false;
  if (decision.authorized !== true || decision.status === 'revoked' || decision.revokedAt) return false;
  return Boolean(
    decision.termVersion
    && decision.termVersion === currentTerm.version
    && decision.termHash
    && decision.termHash === currentTerm.hash
  );
}

export function persistedImageVoiceAuthorization(
  decision: PublicImageVoiceConsentDecision | undefined,
  currentTerm: PublicImageVoiceConsentTermIdentity | undefined,
) {
  if (!decision || !currentTerm || typeof decision.authorized !== 'boolean') return null;
  if (!decision.termVersion || decision.termVersion !== currentTerm.version) return null;
  if (!decision.termHash || decision.termHash !== currentTerm.hash) return null;
  if (decision.status === 'revoked' || decision.revokedAt) return false;
  return decision.authorized;
}

export function resolveSubmittedImageVoiceAuthorization(input: {
  decisionChanged: boolean;
  hasPreviousSubmission: boolean;
  previousDecision: PublicImageVoiceConsentDecision | undefined;
  currentTerm: PublicImageVoiceConsentTermIdentity | undefined;
  submittedAuthorized: boolean;
}) {
  const persisted = persistedImageVoiceAuthorization(input.previousDecision, input.currentTerm);
  if (input.hasPreviousSubmission && !input.decisionChanged && persisted !== null) {
    return persisted;
  }
  return input.submittedAuthorized;
}
