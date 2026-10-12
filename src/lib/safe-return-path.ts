const INTERNAL_ORIGIN = "https://coala.invalid";

export function safeInternalPath(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 2_048 ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  try {
    const url = new URL(normalized, INTERNAL_ORIGIN);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.origin !== INTERNAL_ORIGIN || decodedPath.startsWith("//") || decodedPath.includes("\\")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function resolveSafeReturnPath(value: string | null | undefined, fallback = "/dashboard") {
  return safeInternalPath(value) ?? fallback;
}
