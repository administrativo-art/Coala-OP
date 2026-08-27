export const ONBOARDING_PUBLIC_LINK_TTL_HOURS = 72;
export const ONBOARDING_PUBLIC_LINK_EXTENSION_HOURS = 24;
export const ONBOARDING_PUBLIC_FORM_SUBMITTED_MESSAGE =
  "Este formulário já foi enviado e o prazo de acesso foi encerrado.";

type PublicLinkData = {
  createdAt?: unknown;
  publicFormSubmittedAt?: unknown;
  publicTokenClosedAt?: unknown;
  publicTokenClosedReason?: unknown;
  publicTokenExpiresAt?: unknown;
  publicTokenExtendedAt?: unknown;
  publicTokenExtensionUsed?: unknown;
};

function validDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function createOnboardingPublicLinkWindow(now = new Date()) {
  return {
    publicTokenExpiresAt: addHours(now, ONBOARDING_PUBLIC_LINK_TTL_HOURS).toISOString(),
    publicTokenExtensionUsed: false,
    publicTokenExtendedAt: null,
    publicTokenExtendedBy: null,
  };
}

export function onboardingPublicLinkExpiresAt(data: PublicLinkData) {
  const explicit = validDate(data.publicTokenExpiresAt);
  if (explicit) return explicit;
  const createdAt = validDate(data.createdAt);
  return createdAt ? addHours(createdAt, ONBOARDING_PUBLIC_LINK_TTL_HOURS) : null;
}

export function onboardingPublicLinkExtensionUsed(data: PublicLinkData) {
  return data.publicTokenExtensionUsed === true || Boolean(validDate(data.publicTokenExtendedAt));
}

export function onboardingPublicLinkExpired(data: PublicLinkData, now = new Date()) {
  const expiresAt = onboardingPublicLinkExpiresAt(data);
  return !expiresAt || expiresAt.getTime() <= now.getTime();
}

export function closeOnboardingPublicLink(now = new Date()) {
  return {
    publicTokenClosedAt: now.toISOString(),
    publicTokenClosedReason: "form_submitted",
  };
}

export function onboardingPublicLinkClosedMessage(data: PublicLinkData) {
  if (!validDate(data.publicTokenClosedAt)) return null;
  if (data.publicTokenClosedReason === "form_submitted" || validDate(data.publicFormSubmittedAt)) {
    return ONBOARDING_PUBLIC_FORM_SUBMITTED_MESSAGE;
  }
  return "Este link de onboarding não está mais disponível.";
}

export function extendOnboardingPublicLink(data: PublicLinkData, now = new Date()) {
  if (onboardingPublicLinkExtensionUsed(data)) return null;
  const currentExpiry = onboardingPublicLinkExpiresAt(data);
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return addHours(base, ONBOARDING_PUBLIC_LINK_EXTENSION_HOURS).toISOString();
}
