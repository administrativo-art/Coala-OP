// Only messages constructed by the CLI may reach stderr. Never expose transport errors.
export class PaymentCliError extends Error {}

export function paymentCliErrorMessage(error: unknown) {
  return error instanceof PaymentCliError ? error.message
    : "Falha inesperada na CLI. O resultado de um envio pode ser incerto; consulte o status antes de tentar novamente.";
}

const origins = new Set([
  "https://op.coalashakes.com",
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://firestore.googleapis.com",
]);

export async function paymentCliFetch(url: string, init: RequestInit, fetcher: typeof fetch = fetch) {
  let target: URL;
  try { target = new URL(url); } catch { throw new PaymentCliError("Destino da CLI inválido."); }
  if (!origins.has(target.origin) || target.username || target.password) {
    throw new PaymentCliError("Destino não permitido pela CLI.");
  }
  try {
    // No retry: a failed or timed-out submission can already have reached the server.
    const response = await fetcher(url, {
      ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error();
    return response;
  } catch {
    throw new PaymentCliError("Falha de comunicação ou tempo esgotado. O resultado de um envio pode ser incerto; consulte o status antes de tentar novamente.");
  }
}

export async function paymentCliJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; } catch {
    throw new PaymentCliError("Resposta inválida do serviço. O resultado de um envio pode ser incerto; consulte o status antes de tentar novamente.");
  }
}
