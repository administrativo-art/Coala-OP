import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  assertCashCountingSessionClosureAccess,
  canManageCashCountingSessionsOfOthers,
} from "@/features/financial/cash-counting-sessions/access.server";
import { finishCashCountingSession, getCashCountingSession } from "@/features/financial/cash-counting-sessions/repository.server";
import { finishCashCountingSessionSchema } from "@/features/financial/cash-counting-sessions/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "finish-cash-counting-session",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]/finish",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = finishCashCountingSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new AppError({ code: "CASH_COUNTING_SESSION_FINISH_INVALID", kind: "VALIDATION", cause: parsed.error });
  const { sessionId } = await routeContext.params;
  const current = await getCashCountingSession(sessionId);
  if (!current || current.session.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashCountingSessionClosureAccess(context, "approve", current.session);
  } catch (cause) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_FINISH_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const session = await finishCashCountingSession({
    workspaceId: context.workspace_id,
    sessionId,
    actor: cashClosureActor(context),
    canManageOthers: canManageCashCountingSessionsOfOthers(context),
  }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("em uso por")) {
      throw new AppError({
        code: "CASH_COUNTING_SESSION_FINISH_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Esta sessão está sob responsabilidade de outra pessoa.",
        cause,
      });
    }
    if (message.includes("sessão") || message.includes("Sessão") || message.includes("Finalize ao menos")) {
      throw new AppError({
        code: "CASH_COUNTING_SESSION_FINISH_CONFLICT",
        kind: "CONFLICT",
        safeMessage: "Finalize ao menos um operador em uma sessão aberta antes de encerrar a contagem.",
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json({ session });
});
