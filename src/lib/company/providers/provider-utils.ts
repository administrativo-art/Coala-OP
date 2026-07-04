export type FetchJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
};

function companyLookupUserAgent() {
  return process.env.COMPANY_LOOKUP_USER_AGENT || 'Coala-OP/1.0 (operacoes@coala.local)';
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = Number(process.env.COMPANY_LOOKUP_TIMEOUT_MS ?? 4500),
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': companyLookupUserAgent(),
        ...(options.headers ?? {}),
      },
    });

    const data = (await response.json().catch(() => null)) as T | null;
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Falha de rede',
    };
  } finally {
    clearTimeout(timeout);
  }
}
