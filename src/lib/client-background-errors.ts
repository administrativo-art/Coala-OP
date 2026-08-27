"use client";

export function warnBackgroundLoadError(scope: string, error: unknown) {
  if (process.env.NODE_ENV === "production") return;
  const detail = error instanceof Error ? error.message : error;
  console.warn(`[${scope}] Falha em carregamento de fundo:`, detail);
}
