import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { cashClosureReasonSchema } from "@/features/financial/cash-closures/schemas";
import { reopenCashClosureWithDepositHandling } from "@/features/financial/cash-deposits/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ closureId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "reopen-cash-closure-operator",
  routeOrJob: "/api/financial/cash-closures/[closureId]/reopen",
}, async (request: NextRequest, routeContext) => {
    const context = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
    try {
      assertCashClosureAccess(context, "reopen", current.closure.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_CLOSURE_REOPEN_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    const parsed = cashClosureReasonSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_CLOSURE_REOPEN_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe um motivo válido para reabrir a contagem.",
        cause: parsed.error,
      });
    }
    const { reason, operatorId } = parsed.data;
    const reopened = await reopenCashClosureWithDepositHandling({
      workspaceId: context.workspace_id,
      closureId,
      operatorId,
      reason,
      actor: cashClosureActor(context),
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("não encontrado")) {
        throw new AppError({ code: "CASH_CLOSURE_OPERATOR_NOT_FOUND", kind: "NOT_FOUND", cause });
      }
      if (message.includes("não pode avançar")) {
        throw new AppError({ code: "CASH_CLOSURE_REOPEN_STATE_CONFLICT", kind: "CONFLICT", cause });
      }
      if (message.includes("sessão") || message.includes("Sessão") || message.includes("composição física")) {
        throw new AppError({ code: "CASH_COUNTING_SESSION_REOPEN_CONFLICT", kind: "CONFLICT", safeMessage: message, cause });
      }
      throw cause;
    });
    return NextResponse.json(reopened);
});
