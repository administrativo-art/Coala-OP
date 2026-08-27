const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function randomUuid() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error("crypto.randomUUID indisponível no runtime.");
  }
  return cryptoApi.randomUUID();
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
