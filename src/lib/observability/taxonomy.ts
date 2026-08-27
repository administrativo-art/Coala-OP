export const ERROR_KINDS = [
  "EXPECTED_BUSINESS",
  "AUTHENTICATION",
  "AUTHORIZATION",
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "TRANSIENT_EXTERNAL",
  "PERMANENT_EXTERNAL",
  "UNEXPECTED_APPLICATION",
  "DATA_INTEGRITY",
  "SECURITY_INCIDENT",
  "FINANCIAL_INCIDENT",
] as const;

export const ERROR_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export type ErrorKindDefaults = {
  httpStatus: number;
  reportable: boolean;
  retryable: boolean;
  severity: ErrorSeverity;
  safeMessage: string;
};

export const ERROR_KIND_DEFAULTS: Record<ErrorKind, ErrorKindDefaults> = {
  EXPECTED_BUSINESS: {
    httpStatus: 422,
    reportable: false,
    retryable: false,
    severity: "low",
    safeMessage: "A operação não pode ser concluída neste estado.",
  },
  AUTHENTICATION: {
    httpStatus: 401,
    reportable: false,
    retryable: true,
    severity: "low",
    safeMessage: "Autenticação necessária.",
  },
  AUTHORIZATION: {
    httpStatus: 403,
    reportable: false,
    retryable: false,
    severity: "low",
    safeMessage: "Você não possui permissão para esta operação.",
  },
  VALIDATION: {
    httpStatus: 400,
    reportable: false,
    retryable: false,
    severity: "low",
    safeMessage: "Os dados informados são inválidos.",
  },
  NOT_FOUND: {
    httpStatus: 404,
    reportable: false,
    retryable: false,
    severity: "low",
    safeMessage: "O recurso solicitado não foi encontrado.",
  },
  CONFLICT: {
    httpStatus: 409,
    reportable: false,
    retryable: true,
    severity: "medium",
    safeMessage: "O estado mudou. Atualize os dados e tente novamente.",
  },
  TRANSIENT_EXTERNAL: {
    httpStatus: 503,
    reportable: true,
    retryable: true,
    severity: "medium",
    safeMessage: "Um serviço necessário está temporariamente indisponível.",
  },
  PERMANENT_EXTERNAL: {
    httpStatus: 502,
    reportable: true,
    retryable: false,
    severity: "high",
    safeMessage: "Não foi possível concluir a integração.",
  },
  UNEXPECTED_APPLICATION: {
    httpStatus: 500,
    reportable: true,
    retryable: false,
    severity: "high",
    safeMessage: "Ocorreu uma falha inesperada.",
  },
  DATA_INTEGRITY: {
    httpStatus: 500,
    reportable: true,
    retryable: false,
    severity: "critical",
    safeMessage: "A operação foi interrompida para preservar a integridade dos dados.",
  },
  SECURITY_INCIDENT: {
    httpStatus: 403,
    reportable: true,
    retryable: false,
    severity: "critical",
    safeMessage: "A operação não pôde ser concluída.",
  },
  FINANCIAL_INCIDENT: {
    httpStatus: 500,
    reportable: true,
    retryable: false,
    severity: "critical",
    safeMessage: "A operação financeira não foi concluída.",
  },
};
