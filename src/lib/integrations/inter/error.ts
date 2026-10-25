import axios from "axios";

import { AppError } from "@/lib/observability";
import { sanitizeValue } from "@/lib/observability/sanitize";

export type InterOperation = "oauth-token" | "api-request" | "certificate-validation";

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
]);
const RESPONSE_DETAILS_LIMIT = 2_000;

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

const PAYMENT_REJECTION_FIELDS = [
  ["codBarralinhaDigitavel", "O Banco Inter recusou a linha digitável do boleto."],
  ["valorPagar", "O Banco Inter recusou o valor informado para o pagamento."],
  ["dataPagamento", "O Banco Inter recusou a data programada do pagamento."],
  ["dataVencimento", "O Banco Inter recusou o vencimento informado para o boleto."],
  ["cpfCnpjBeneficiario", "O Banco Inter recusou o CPF/CNPJ informado para o beneficiário."],
] as const;

function safePaymentRejectionMessage(error: unknown) {
  try {
    if (!axios.isAxiosError(error)) return null;
    const pending: Array<{ value: unknown; depth: number }> = [{ value: error.response?.data, depth: 0 }];
    const observed = new Set<string>();
    let visited = 0;
    while (pending.length && visited < 100) {
      const current = pending.shift()!;
      visited += 1;
      if (typeof current.value === "string") {
        for (const [field] of PAYMENT_REJECTION_FIELDS) {
          if (current.value.toLowerCase().includes(field.toLowerCase())) observed.add(field);
        }
        continue;
      }
      if (!current.value || typeof current.value !== "object" || current.depth >= 4) continue;
      const entries = Array.isArray(current.value)
        ? current.value.map((value) => ["", value] as const)
        : Object.entries(current.value as Record<string, unknown>);
      for (const [key, value] of entries) {
        for (const [field] of PAYMENT_REJECTION_FIELDS) {
          if (key.toLowerCase() === field.toLowerCase()) observed.add(field);
        }
        pending.push({ value, depth: current.depth + 1 });
      }
    }
    if (observed.size !== 1) return null;
    const field = [...observed][0];
    return PAYMENT_REJECTION_FIELDS.find(([candidate]) => candidate === field)?.[1] ?? null;
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
    safeMessage: operation === "api-request" && (statusCode === 400 || statusCode === 422)
      ? safePaymentRejectionMessage(error) ?? undefined
      : undefined,
    // OAuth failures can contain credential-shaped provider payloads. Keep
    // those outside the serialized error boundary; payment API failures still
    // retain the bounded, redacted provider reason for backend diagnostics.
    responseDetails: operation === "oauth-token" ? null : interResponseDetails(error),
  });
}
