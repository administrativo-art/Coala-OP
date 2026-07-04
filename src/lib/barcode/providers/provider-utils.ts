export async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4500,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, status: response.status };
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Falha de rede' };
  } finally {
    clearTimeout(timeout);
  }
}

export function appUserAgent() {
  return process.env.OPEN_FOOD_FACTS_USER_AGENT || 'Coala-OP/1.0 (operacoes@coala.local)';
}
