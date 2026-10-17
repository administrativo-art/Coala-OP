import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  assertCashClosureDivergenceApproval,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { finalizeCashClosureOperator, getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { finalizeCashClosureOperatorSchema } from "@/features/financial/cash-closures/schemas";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

type RouteContext = { params: Promise<{ closureId: string }> };
type FinalizeInput = { operatorId: string; countingSessionId: string };
type ClosureResource = NonNullable<Awaited<ReturnType<typeof getCashClosure>>>;
const ROUTE = "/api/financial/cash-closures/[closureId]/finalize";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.cash-closure.operator-finalize",
  version: 1,
  surface: { method: "POST", path: ROUTE },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.cash-closures.approve" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "financial.cash-closure.operator-finalize", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

function throwFinalizationError(cause: unknown): never {
  if (cause instanceof AppError) throw cause;
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("em uso por")) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Esta sessão está sob responsabilidade de outra pessoa.",
      cause,
    });
  }
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("já foi finalizada")) {
    throw new AppError({
      code: "CASH_CLOSURE_OPERATOR_ALREADY_FINALIZED",
      kind: "CONFLICT",
      safeMessage: "A contagem deste operador já foi finalizada.",
      cause,
    });
  }
  if (message.includes("sessão") || message.includes("Sessão")) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "A sessão de contagem não permite finalizar este operador agora.",
      cause,
    });
  }
  if (message.includes("Preencha as contagens")) {
    throw new AppError({
      code: "CASH_CLOSURE_COUNT_INCOMPLETE",
      kind: "VALIDATION",
      safeMessage: "Preencha as contagens do Caixa e do Financeiro antes de finalizar.",
      cause,
    });
  }
  if (message.includes("Toda falta")) {
    throw new AppError({
      code: "CASH_CLOSURE_DIVERGENCE_NOTE_REQUIRED",
      kind: "VALIDATION",
      safeMessage: "O Financeiro deve justificar cada falta confirmada antes de finalizar.",
      cause,
    });
  }
  if (message.includes("não pode avançar")) {
    throw new AppError({ code: "CASH_CLOSURE_STATE_CONFLICT", kind: "CONFLICT", cause });
  }
  if (message.includes("perfil sênior") || message.includes("Sem permissão")) {
    throw new AppError({ code: "CASH_CLOSURE_FINALIZE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "A permissão ou a divergência mudou. Confira seu acesso e atualize a contagem.", cause });
  }
  throw cause;
}

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, FinalizeInput, ClosureResource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  }),
  parseInput: async ({ request }) => {
    const parsed = finalizeCashClosureOperatorSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_CLOSURE_OPERATOR_INVALID",
        kind: "VALIDATION",
        safeMessage: "Selecione um operador válido para finalizar.",
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
  authorize: ({ actor, input, resource }) => {
    try {
      assertCashClosureAccess(actor, "approve", resource.closure.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_CLOSURE_FINALIZE_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    try {
      assertCashClosureDivergenceApproval(
        actor,
        resource.closure.kioskId,
        resource.lines.filter((line) => line.operatorId === input.operatorId),
      );
    } catch (cause) {
      throw new AppError({
        code: "CASH_CLOSURE_SENIOR_FINALIZATION_REQUIRED",
        kind: "AUTHORIZATION",
        safeMessage: "Esta divergência exige um perfil sênior para finalizar a contagem.",
        cause,
      });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.closure.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_CLOSURE_FINALIZE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  },
});

export const POST = secureRoute({
  contract,
  enforcer,
  observability: { source: "api", operation: "finalize-cash-closure-count" },
}, async ({ routeContext, security }) => {
  const { closureId } = await routeContext.params;
  const finalized = await finalizeCashClosureOperator(
    closureId,
    security.input.operatorId,
    cashClosureActor(security.actor),
    {
      countingSessionId: security.input.countingSessionId,
      authorizationContext: security.actor,
      canManageSessionOfOthers: security.actor.isDefaultAdmin || security.actor.permissions.financial?.cashClosures?.reopen === true,
    },
  ).catch(throwFinalizationError);
  const closure = finalized.closure;
  return NextResponse.json({ closure, countingSessionId: security.input.countingSessionId });
});
