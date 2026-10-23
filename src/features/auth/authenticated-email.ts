function normalizedEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/**
 * The verified Firebase identity is authoritative for authentication gates.
 * The application document is only a fallback because it can lag behind an
 * email change made in Firebase Authentication.
 */
export function resolveAuthenticatedEmail(
  firebaseEmail: unknown,
  storedEmail: unknown,
) {
  return normalizedEmail(firebaseEmail) ?? normalizedEmail(storedEmail);
}
