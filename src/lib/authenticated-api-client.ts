export class AuthenticatedApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "AuthenticatedApiError";
    this.status = status;
    this.payload = payload;
  }
}

export type AuthenticatedApiRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | null;
  json?: unknown;
  fallbackError?: string;
  responseType?: "auto" | "blob";
};

type AuthenticatedApiTransportInit = AuthenticatedApiRequestInit & {
  getIdToken: () => Promise<string | null | undefined>;
  fetchImpl?: typeof fetch;
};

function errorMessage(payload: unknown, fallbackError: string, status: number) {
  if (payload && typeof payload === "object") {
    for (const key of ["error", "message"] as const) {
      const value = (payload as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return `${fallbackError} (HTTP ${status})`;
}

async function readResponsePayload(response: Response) {
  if (response.status === 204 || response.status === 205) return undefined;
  const raw = await response.text();
  if (!raw) return undefined;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const looksLikeJson = /^[\s\n\r]*[\[{]/.test(raw);
  if (contentType.includes("json") || looksLikeJson) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // A resposta continua observável como texto; o status decide se é erro.
    }
  }
  return raw;
}

export async function authenticatedApiRequest<T = unknown>(
  input: RequestInfo | URL,
  init: AuthenticatedApiTransportInit,
): Promise<T> {
  const {
    getIdToken,
    fetchImpl = fetch,
    fallbackError = "Falha na operação.",
    headers: callerHeaders,
    body,
    json,
    responseType = "auto",
    cache,
    ...requestInit
  } = init;

  if (json !== undefined && body !== undefined) {
    throw new Error("Use apenas uma das opções: json ou body.");
  }

  const token = await getIdToken();
  if (!token) {
    throw new AuthenticatedApiError("Sessão não disponível.", 401, null);
  }

  const headers = new Headers(callerHeaders);
  headers.set("Authorization", `Bearer ${token}`);
  let requestBody = body;
  if (json !== undefined) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(json);
  }

  const response = await fetchImpl(input, {
    ...requestInit,
    headers,
    body: requestBody,
    cache: cache ?? "no-store",
  });
  const payload = responseType === "blob" && response.ok
    ? await response.blob()
    : await readResponsePayload(response);
  if (!response.ok) {
    throw new AuthenticatedApiError(
      errorMessage(payload, fallbackError, response.status),
      response.status,
      payload,
    );
  }
  return payload as T;
}
