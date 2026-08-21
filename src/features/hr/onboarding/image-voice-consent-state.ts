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
