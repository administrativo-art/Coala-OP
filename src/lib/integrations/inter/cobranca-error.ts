export class InterCobrancaApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "InterCobrancaApiError";
    this.status = status;
  }
}

export function classifyInterCobrancaApiError(error: unknown) {
  if (!(error instanceof InterCobrancaApiError)) return null;
  if (error.status === 400 || error.status === 422) return "invalid-request" as const;
  if (error.status === 401 || error.status === 403) return "authorization" as const;
  return null;
}
