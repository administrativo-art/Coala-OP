import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { cashClosureReasonSchema } from "@/features/financial/cash-closures/schemas";
import { reopenCashClosureWithDepositHandling } from "@/features/financial/cash-deposits/repository.server";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

type RouteContext = { params: Promise<{ closureId: string }> };
type ReopenInput = { reason: string; operatorId?: string };
type ClosureResource = NonNullable<Awaited<ReturnType<typeof getCashClosure>>>;
const ROUTE = "/api/financial/cash-closures/[closureId]/reopen";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.cash-closure.operator-reopen",
  version: 1,
  surface: { method: "POST", path: ROUTE },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.cash-closures.reopen" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "financial.cash-closure.operator-reopen", unknownFields: "strip" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, ReopenInput, ClosureResource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => {
      throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  }),
  parseInput: async ({ request }) => {
    const parsed = cashClosureReasonSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_CLOSURE_REOPEN_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe um motivo válido para reabrir a contagem.",
        cause: parsed.error,
      });
    }
    return parsed.data;
  },
  loadResource: async ({ routeContext }) => {
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
    return current;
  },
  authorize: ({ actor, resource }) => {
    try {
      assertCashClosureAccess(actor, "reopen", resource.closure.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_CLOSURE_REOPEN_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.closure.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_CLOSURE_REOPEN_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  },
});

export const POST = secureRoute({
  contract,
  enforcer,
  observability: { source: "api-financial", operation: "reopen-cash-closure-operator" },
}, async ({ routeContext, security }) => {
    const { closureId } = await routeContext.params;
    const { reason, operatorId } = security.input;
    const reopened = await reopenCashClosureWithDepositHandling({
      workspaceId: security.actor.workspace_id,
      closureId,
      operatorId,
      reason,
      actor: cashClosureActor(security.actor),
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("não encontrado")) {
        throw new AppError({ code: "CASH_CLOSURE_OPERATOR_NOT_FOUND", kind: "NOT_FOUND", cause });
      }
      if (message.includes("não pode avançar")) {
        throw new AppError({ code: "CASH_CLOSURE_REOPEN_STATE_CONFLICT", kind: "CONFLICT", cause });
      }
      if (message.includes("individualmente")) {
        throw new AppError({
          code: "CASH_CLOSURE_OPERATOR_REQUIRED",
          kind: "VALIDATION",
          safeMessage: "Reabra um operador por vez quando o fechamento estiver vinculado a uma sessão de contagem.",
          cause,
        });
      }
      if (message.includes("boleto emitido")) {
        throw new AppError({
          code: "CASH_COUNTING_SESSION_REOPEN_AFTER_ISSUE_FORBIDDEN",
          kind: "CONFLICT",
          safeMessage: "Esta sessão já possui boleto emitido e não pode mais ser reaberta.",
          cause,
        });
      }
      if (message.includes("sessão") || message.includes("Sessão") || message.includes("composição física")) {
        throw new AppError({
          code: "CASH_COUNTING_SESSION_REOPEN_CONFLICT",
          kind: "CONFLICT",
          safeMessage: "Não foi possível retirar esta sessão do depósito para reabrir a contagem.",
          cause,
        });
      }
      throw cause;
    });
    return NextResponse.json(reopened);
});
