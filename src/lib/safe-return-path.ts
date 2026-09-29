export function resolveSafeReturnPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value) return fallback;
  const normalized = value.trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("\\")) {
    return fallback;
  }
  return normalized;
}
