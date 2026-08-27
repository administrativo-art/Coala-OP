const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function randomUuid() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("API criptográfica indisponível no runtime.");
}

export function generateEventId() {
  return randomUuid();
}

export function generateRequestId() {
  return randomUuid();
}

export function normalizeOpaqueId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!OPAQUE_ID_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function headerValue(input: Headers | Request, name: string) {
  const headers = input instanceof Headers ? input : input.headers;
  return headers.get(name);
}

export function resolveRequestId(input: Headers | Request) {
  return normalizeOpaqueId(headerValue(input, "x-request-id")) ?? generateRequestId();
}

export function resolveCorrelationId(input: Headers | Request) {
  return normalizeOpaqueId(headerValue(input, "x-correlation-id"));
}
