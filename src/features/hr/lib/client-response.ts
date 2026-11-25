export async function readHrJsonResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const raw = await response.text();
  let payload: unknown = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const rawError = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: unknown }).error
      : null;
    const serverMessage = typeof rawError === 'string'
      ? rawError
      : rawError && typeof rawError === 'object' && 'message' in rawError
        ? (rawError as { message?: unknown }).message
        : null;
    throw new Error(
      typeof serverMessage === 'string' && serverMessage.trim()
        ? serverMessage
        : `${fallbackError} (HTTP ${response.status})`,
    );
  }

  if (payload === null) {
    throw new Error(`${fallbackError} Resposta inválida do servidor.`);
  }

  return payload as T;
}

/** Mensagem de erro de uma resposta de RH em qualquer dos dois formatos: texto legado ou envelope `{ error: { message } }`. */
export function hrErrorMessage(payload: unknown, fallback: string): string {
  const raw = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error?: unknown }).error : null;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (raw && typeof raw === 'object' && 'message' in raw && typeof (raw as { message?: unknown }).message === 'string') {
    return (raw as { message: string }).message;
  }
  return fallback;
}
