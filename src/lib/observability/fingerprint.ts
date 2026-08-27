export type FingerprintInput = {
  errorCode: string;
  source: string;
  routeOrJob?: string;
  operation?: string;
  errorName?: string;
  stack?: string;
};

function normalizeDynamicValues(value: string) {
  return value
    .split("?")[0]
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, ":uuid")
    .replace(/\b[0-9a-f]{16,}\b/gi, ":hex")
    .replace(/\b\d{6,}\b/g, ":number")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ":email")
    .replace(/\/(?=[A-Za-z0-9_-]{12,}(?:\/|$))(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+/g, "/:id")
    .replace(/:\d+:\d+/g, ":line:column")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function topFrames(stack: string | undefined) {
  if (!stack) return "";
  return stack
    .split("\n")
    .slice(1, 5)
    .map(normalizeDynamicValues)
    .join("|");
}

function fnv1a32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function createErrorFingerprint(input: FingerprintInput) {
  const identity = [
    input.errorCode,
    input.source,
    input.routeOrJob ?? "",
    input.operation ?? "",
    input.errorName ?? "Error",
    topFrames(input.stack),
  ].map(normalizeDynamicValues).join("|");
  const first = fnv1a32(identity, 0x811c9dc5);
  const second = fnv1a32(identity.split("").reverse().join(""), 0x9e3779b9);
  return `err-v1-${first}${second}`;
}
