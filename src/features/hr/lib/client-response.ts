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
    const serverMessage = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: unknown }).error
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
