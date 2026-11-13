import { NextResponse } from "next/server";

/**
 * Resposta pública de conflito/validação do editor: `{ error: { code, message }, ...extra }`.
 * Código e mensagem são constantes escritas na rota (nunca texto de exceção); `extra` só carrega
 * números ou chaves de campo do catálogo (ex.: `currentVersion`, `missingKeys`). O formato é o
 * que o cliente do editor já lê (`editor-client.ts`). Fica num único lugar para as rotas não
 * montarem o envelope à mão.
 */
export function editorErrorResponse(
  status: 409 | 422,
  code: string,
  message: string,
  extra: Record<string, number | string[] | null>,
  headers: HeadersInit = { "Cache-Control": "no-store" },
) {
  return NextResponse.json({ error: { code, message }, ...extra }, { status, headers });
}
