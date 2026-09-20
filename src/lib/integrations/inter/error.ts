import axios from "axios";

import { AppError } from "@/lib/observability";

export type InterOperation = "oauth-token" | "api-request" | "certificate-validation";

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

export function isTransientInterFailure(error: unknown) {
  const { statusCode, networkCode } = axiosFacts(error);
  return statusCode !== null
    ? TRANSIENT_HTTP_STATUSES.has(statusCode)
    : Boolean(networkCode && TRANSIENT_NETWORK_CODES.has(networkCode));
}

export class InterApiError extends AppError {
  readonly statusCode: number | null;
  readonly operation: InterOperation;

  constructor(options: {
    code: string;
    operation: InterOperation;
    statusCode?: number | null;
    retryable?: boolean;
    safeMessage?: string;
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
      },
    });
    this.name = "InterApiError";
    this.statusCode = options.statusCode ?? null;
    this.operation = options.operation;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.safeMessage,
      operation: this.operation,
      retryable: this.retryable,
      statusCode: this.statusCode,
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
  });
}
