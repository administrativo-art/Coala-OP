import { ERROR_KIND_DEFAULTS, type ErrorKind, type ErrorSeverity } from "./taxonomy";

export type AppErrorOptions = {
  code: string;
  kind: ErrorKind;
  safeMessage?: string;
  httpStatus?: number;
  severity?: ErrorSeverity;
  reportable?: boolean;
  retryable?: boolean;
  cause?: unknown;
  metadata?: Record<string, unknown>;
};

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;

export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly httpStatus: number;
  readonly safeMessage: string;
  readonly severity: ErrorSeverity;
  readonly reportable: boolean;
  readonly retryable: boolean;
  readonly metadata: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(options: AppErrorOptions) {
    if (!ERROR_CODE_PATTERN.test(options.code)) {
      throw new TypeError("AppError.code deve ser um identificador estável em maiúsculas.");
    }
    const defaults = ERROR_KIND_DEFAULTS[options.kind];
    super(options.safeMessage ?? defaults.safeMessage);
    this.name = "AppError";
    this.code = options.code;
    this.kind = options.kind;
    this.httpStatus = options.httpStatus ?? defaults.httpStatus;
    this.safeMessage = options.safeMessage ?? defaults.safeMessage;
    this.severity = options.severity ?? defaults.severity;
    this.reportable = options.reportable ?? defaults.reportable;
    this.retryable = options.retryable ?? defaults.retryable;
    this.cause = options.cause;
    this.metadata = options.metadata ?? {};
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
