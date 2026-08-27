const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";
const CIRCULAR = "[CIRCULAR]";
const TRUNCATED = "…[TRUNCATED]";

const MAX_DEPTH = 5;
const MAX_KEYS = 30;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;

const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|token|secret|password|senha|credential|private.?key|api.?key|client.?secret|cpf|cnpj|\brg\b|salary|salario|remuneracao|bank|banco|account|conta|agency|agencia|pix|medical|medic|health|diagnos|documento|document|payload|body)/i;
const SAFE_HEADER_NAMES = new Set(["accept", "content-type", "user-agent", "x-request-id", "x-correlation-id"]);
const DEFAULT_METADATA_KEYS = new Set([
  "action",
  "attempt",
  "batchSize",
  "domainEventId",
  "durationMs",
  "failureCount",
  "isTerminal",
  "method",
  "operation",
  "provider",
  "reasonCode",
  "resourceId",
  "resourceType",
  "retryAttempt",
  "route",
  "source",
  "status",
  "statusCode",
  "successCount",
  "unitCount",
  "workspaceId",
]);

export type SanitizeOptions = {
  allowedMetadataKeys?: Iterable<string>;
};

function truncate(value: string, limit = MAX_STRING_LENGTH) {
  if (value.length <= limit) return value;
  const contentLimit = Math.max(0, limit - TRUNCATED.length);
  return `${value.slice(0, contentLimit)}${TRUNCATED}`;
}

function redactInline(value: string) {
  return value
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, REDACTED)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, REDACTED)
    .replace(/\b(Authorization|Cookie|Set-Cookie)\s*[:=]\s*[^\r\n]*/gi, "$1: [REDACTED]")
    .replace(/([?&](?:token|key|secret|password|senha|authorization|api[_-]?key|client[_-]?secret)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/\b(?:token|secret|password|senha|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s,"'}]+/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED)
    .replace(/https?:\/\/[^\s)>\]]+/gi, (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return rawUrl;
      }
    })
    .replace(/\/(?:Users|home)\/[^/\s)]+/g, (localPath) => `${localPath.slice(0, localPath.lastIndexOf("/") + 1)}${REDACTED}`)
    .replace(/[A-Za-z]:\\Users\\[^\\\s)]+/g, (localPath) => `${localPath.slice(0, localPath.lastIndexOf("\\") + 1)}${REDACTED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, REDACTED)
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, REDACTED)
    .replace(/\b\d{11,19}\b/g, REDACTED);
}

function redactString(value: string, limit = MAX_STRING_LENGTH) {
  return truncate(redactInline(value), limit);
}

export function sanitizeStack(stack: string | undefined) {
  if (!stack) return undefined;
  const normalized = stack
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => redactInline(line))
    .join("\n");
  if (normalized.length <= MAX_STACK_LENGTH) return normalized;
  const marker = `\n${TRUNCATED}`;
  const available = Math.max(0, MAX_STACK_LENGTH - marker.length);
  const preliminary = normalized.slice(0, available);
  const lastLineBreak = preliminary.lastIndexOf("\n");
  const preserved = lastLineBreak > 0 ? preliminary.slice(0, lastLineBreak) : preliminary;
  return `${preserved}${marker}`;
}

function sanitizeHeaders(headers: Headers) {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const normalized = key.toLowerCase();
    if (!SAFE_HEADER_NAMES.has(normalized)) continue;
    result[normalized] = SENSITIVE_KEY.test(normalized) ? REDACTED : redactString(value, 500);
  }
  return result;
}

function looksLikeFirestoreSnapshot(value: Record<string, unknown>) {
  return "id" in value && ("ref" in value || "exists" in value) && ("data" in value || typeof value.get === "function");
}

function sanitizeSnapshot(value: Record<string, unknown>) {
  const ref = value.ref && typeof value.ref === "object" ? value.ref as Record<string, unknown> : null;
  return {
    type: "firestore-snapshot",
    id: typeof value.id === "string" ? redactString(value.id, 200) : undefined,
    path: typeof ref?.path === "string" ? redactString(ref.path, 500) : undefined,
    exists: typeof value.exists === "boolean" ? value.exists : undefined,
  };
}

function sanitizeUnknown(
  value: unknown,
  state: { seen: WeakSet<object>; depth: number; allowKeys: Set<string>; metadataRoot: boolean },
): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactString(value);
  if (typeof value === "symbol" || typeof value === "function") return OMITTED;
  if (state.depth >= MAX_DEPTH) return OMITTED;

  if (typeof Request !== "undefined" && value instanceof Request) {
    return {
      type: "Request",
      method: value.method,
      url: redactString(value.url, 1_000),
      headers: sanitizeHeaders(value.headers),
    };
  }
  if (typeof Response !== "undefined" && value instanceof Response) {
    return { type: "Response", status: value.status, statusText: redactString(value.statusText, 300) };
  }
  if (value instanceof Error) {
    return {
      name: redactString(value.name, 200),
      message: redactString(value.message),
      stack: sanitizeStack(value.stack),
    };
  }
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? "Invalid Date" : value.toISOString();
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[BINARY:${value.byteLength}]`;

  if (typeof value !== "object") return redactString(String(value));
  if (state.seen.has(value)) return CIRCULAR;
  state.seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeUnknown(item, {
      ...state,
      depth: state.depth + 1,
      metadataRoot: false,
    }));
  }

  const record = value as Record<string, unknown>;
  if (looksLikeFirestoreSnapshot(record)) return sanitizeSnapshot(record);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).slice(0, MAX_KEYS)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    if (state.metadataRoot && !state.allowKeys.has(key) && !/^[a-z][A-Za-z0-9]*Id$/.test(key)) {
      result[key] = OMITTED;
      continue;
    }
    result[key] = sanitizeUnknown(item, {
      ...state,
      depth: state.depth + 1,
      metadataRoot: false,
    });
  }
  return result;
}

export function sanitizeValue(value: unknown) {
  try {
    return sanitizeUnknown(value, {
      seen: new WeakSet(),
      depth: 0,
      allowKeys: DEFAULT_METADATA_KEYS,
      metadataRoot: false,
    });
  } catch {
    return OMITTED;
  }
}

export function sanitizeMetadata(value: unknown, options: SanitizeOptions = {}) {
  const allowKeys = new Set(DEFAULT_METADATA_KEYS);
  for (const key of options.allowedMetadataKeys ?? []) allowKeys.add(key);
  try {
    const result = sanitizeUnknown(value, {
      seen: new WeakSet(),
      depth: 0,
      allowKeys,
      metadataRoot: true,
    });
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: redactString(error.name || "Error", 200),
      message: redactString(error.message || "Falha sem mensagem."),
      stack: sanitizeStack(error.stack),
    };
  }
  if (typeof error === "string") {
    const stack = /(?:^|\n)\s*at\s+/m.test(error) ? sanitizeStack(error) : undefined;
    const firstLine = error.replace(/\r\n?/g, "\n").split("\n")[0] || "Falha sem mensagem.";
    return {
      name: "UnknownError",
      message: redactString(firstLine),
      stack,
    };
  }
  return {
    name: "UnknownError",
    message: "Falha sem mensagem.",
    stack: undefined,
  };
}

export const SANITIZED_MARKERS = { REDACTED, OMITTED, CIRCULAR, TRUNCATED } as const;
export const SANITIZE_LIMITS = { MAX_STRING_LENGTH, MAX_STACK_LENGTH } as const;
