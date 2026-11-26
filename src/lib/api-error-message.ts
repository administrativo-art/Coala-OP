/**
 * Mensagem de um corpo de erro da API: aceita o envelope central (`{ error: { message } }`) e o formato antigo
 * (`{ error: "..." }`). Pode ser usado no navegador.
 */
export function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
