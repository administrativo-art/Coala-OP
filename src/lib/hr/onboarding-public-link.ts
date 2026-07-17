export const ONBOARDING_PUBLIC_LINK_TTL_HOURS = 72;
export const ONBOARDING_PUBLIC_LINK_EXTENSION_HOURS = 24;

type PublicLinkData = {
  createdAt?: unknown;
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

export function extendOnboardingPublicLink(data: PublicLinkData, now = new Date()) {
  if (onboardingPublicLinkExtensionUsed(data)) return null;
  const currentExpiry = onboardingPublicLinkExpiresAt(data);
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return addHours(base, ONBOARDING_PUBLIC_LINK_EXTENSION_HOURS).toISOString();
}
