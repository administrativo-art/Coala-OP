import "server-only";

import type { NextRequest } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";

import { requireUser } from "@/lib/auth-server";
import { AppError, isAppError } from "@/lib/observability/app-error";

/** Mensagens de acesso que o usuário precisa ler; as demais falhas de autenticação usam o texto padrão. */
const USER_FACING_ACCESS_MESSAGES = new Set([
  "O modo Visualizar como é somente leitura. Volte ao seu perfil para alterar dados.",
  "Conta inativa.",
  "Usuário selecionado não está disponível.",
  "Atualização cadastral obrigatória pendente.",
  "Sem permissão para acessar o RH.",
  "Sem permissão para gerenciar cargos e funções.",
  "Sem permissão para executar esta ação na formalização admissional.",
]);

/** Converte a falha comum de `requireUser`/`assertHrAccess` no erro controlado, sem repassar mensagem interna. */
export function toRouteAccessError(cause: unknown, codePrefix: string) {
  if (isAppError(cause)) return cause;
  const message = cause instanceof Error ? cause.message : "";
  if (USER_FACING_ACCESS_MESSAGES.has(message)) {
    return new AppError({ code: `${codePrefix}_FORBIDDEN`, kind: "AUTHORIZATION", safeMessage: message, cause });
  }
  const authCodes = new Set(["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found"]);
  const authMessages = new Set(["Authorization header ausente ou inválido.", "Usuário inválido.", "Usuário não encontrado."]);
  let current: unknown = cause;
  const visited = new Set<unknown>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (isAppError(current)) return current;
    const error = current as { code?: unknown; cause?: unknown };
    if (authCodes.has(String(error.code ?? "")) || current instanceof Error && authMessages.has(current.message)) {
      return new AppError({ code: `${codePrefix}_AUTHENTICATION_REQUIRED`, kind: "AUTHENTICATION", cause });
    }
    current = error.cause;
  }
  return new AppError({ code: `${codePrefix}_ACCESS_FAILED`, kind: "UNEXPECTED_APPLICATION", cause });
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
