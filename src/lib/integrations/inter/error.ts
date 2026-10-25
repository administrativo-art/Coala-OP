import axios from "axios";

import { AppError } from "@/lib/observability";
import { sanitizeValue } from "@/lib/observability/sanitize";

export type InterOperation = "oauth-token" | "api-request" | "certificate-validation";

const RESPONSE_DETAILS_LIMIT = 2_000;

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function axiosFacts(error: unknown) {
  try {
    if (!axios.isAxiosError(error)) return { statusCode: null, networkCode: null };
    return {
      statusCode: typeof error.response?.status === "number" ? error.response.status : null,
      networkCode: typeof error.code === "string" ? error.code.toUpperCase() : null,
    };
  } catch {
    return { statusCode: null, networkCode: null };
  }
}

/** Preserve only a bounded, redacted summary of the provider response. */
export function interResponseDetails(error: unknown): string | null {
  try {
    const data = axios.isAxiosError(error)
      ? error.response?.data
      : (
        error && typeof error === "object" && "response" in error
          ? ((error as { response?: { data?: unknown } }).response?.data)
          : undefined
      );
    if (data === undefined || data === null || data === "") return null;
    const sanitized = sanitizeValue(data);
    const serialized = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
    if (!serialized || serialized === "{}" || serialized === "null") return null;
    return serialized.slice(0, RESPONSE_DETAILS_LIMIT);
  } catch {
    return null;
  }
}

export function isTransientInterFailure(error: unknown) {
  const { statusCode, networkCode } = axiosFacts(error);
  return statusCode !== null
    ? TRANSIENT_HTTP_STATUSES.has(statusCode)
    : Boolean(networkCode && TRANSIENT_NETWORK_CODES.has(networkCode));
}

export class InterApiError extends AppError {
  readonly statusCode: number | null;
  readonly operation: InterOperation;
  readonly responseDetails: string | null;

  constructor(options: {
    code: string;
    operation: InterOperation;
    statusCode?: number | null;
    retryable?: boolean;
    safeMessage?: string;
    responseDetails?: string | null;
  }) {
    const retryable = options.retryable ?? false;
    super({
      code: options.code,
      kind: retryable ? "TRANSIENT_EXTERNAL" : "PERMANENT_EXTERNAL",
      safeMessage: options.safeMessage ?? (
        retryable
          ? "O Banco Inter está temporariamente indisponível. Consulte novamente antes de repetir qualquer envio."
          : "Não foi possível concluir a comunicação com o Banco Inter."
      ),
      retryable,
      metadata: {
        provider: "Banco Inter",
        operation: options.operation,
        statusCode: options.statusCode ?? null,
        ...(options.responseDetails ? { responseDetails: options.responseDetails } : {}),
      },
    });
    this.name = "InterApiError";
    this.statusCode = options.statusCode ?? null;
    this.operation = options.operation;
    this.responseDetails = options.responseDetails ?? null;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.safeMessage,
      operation: this.operation,
      retryable: this.retryable,
      statusCode: this.statusCode,
      ...(this.responseDetails ? { responseDetails: this.responseDetails } : {}),
    };
  }
}

export function safeInterApiError(error: unknown, operation: InterOperation) {
  if (error instanceof InterApiError) return error;
  const { statusCode } = axiosFacts(error);
  const retryable = isTransientInterFailure(error);
  return new InterApiError({
    code: statusCode === null ? "INTER_REQUEST_FAILED" : `INTER_HTTP_${statusCode}`,
    operation,
    statusCode,
    retryable,
    // OAuth failures can contain credential-shaped provider payloads. Keep
    // those outside the serialized error boundary; payment API failures still
    // retain the bounded, redacted provider reason for backend diagnostics.
    responseDetails: operation === "oauth-token" ? null : interResponseDetails(error),
  });
}
