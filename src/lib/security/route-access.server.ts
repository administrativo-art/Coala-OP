import "server-only";

import type { NextRequest } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";

import { requireUser } from "@/lib/auth-server";
import { AppError, isAppError } from "@/lib/observability/app-error";

/** Mensagens de acesso que o usuário precisa ler; as demais falhas de autenticação usam o texto padrão. */
const USER_FACING_ACCESS_MESSAGES = [
  "O modo Visualizar como é somente leitura.",
  "Conta inativa.",
  "Atualização cadastral obrigatória pendente.",
  "Sem permissão ",
];

/** Converte a falha comum de `requireUser`/`assertHrAccess` no erro controlado, sem repassar mensagem interna. */
export function toRouteAccessError(cause: unknown, codePrefix: string) {
  if (isAppError(cause)) return cause;
  const message = cause instanceof Error ? cause.message : "";
  return USER_FACING_ACCESS_MESSAGES.some((prefix) => message.startsWith(prefix))
    ? new AppError({ code: `${codePrefix}_FORBIDDEN`, kind: "AUTHORIZATION", safeMessage: message, cause })
    : new AppError({ code: `${codePrefix}_AUTHENTICATION_REQUIRED`, kind: "AUTHENTICATION", cause });
}

export function requireRouteUser(request: NextRequest, codePrefix: string) {
  return requireUser(request).catch((cause) => { throw toRouteAccessError(cause, codePrefix); });
}

/** Lê e valida o corpo JSON. A mensagem é a do primeiro problema do schema. */
export async function parseRouteBody<Output>(request: NextRequest, schema: ZodType<Output, ZodTypeDef, unknown>, codePrefix: string): Promise<Output> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    throw new AppError({
      code: `${codePrefix}_INPUT_INVALID`,
      kind: "VALIDATION",
      safeMessage: `Revise os dados informados${field ? ` (${field})` : ""}: ${issue?.message ?? "formato inválido"}.`,
    });
  }
  return parsed.data;
}
