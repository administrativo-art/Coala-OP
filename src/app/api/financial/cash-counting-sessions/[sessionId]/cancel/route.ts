import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  assertCashCountingSessionClosureAccess,
  canManageCashCountingSessionsOfOthers,
} from "@/features/financial/cash-counting-sessions/access.server";
import { cancelCashCountingSession, getCashCountingSession } from "@/features/financial/cash-counting-sessions/repository.server";
import { cancelCashCountingSessionSchema } from "@/features/financial/cash-counting-sessions/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "cancel-cash-counting-session",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]/cancel",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = cancelCashCountingSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AppError({ code: "CASH_COUNTING_SESSION_CANCEL_INVALID", kind: "VALIDATION", safeMessage: "Informe o motivo do cancelamento.", cause: parsed.error });
  const { sessionId } = await routeContext.params;
  const current = await getCashCountingSession(sessionId);
  if (!current || current.session.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashCountingSessionClosureAccess(context, "approve", current.session);
  } catch (cause) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_CANCEL_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const session = await cancelCashCountingSession({
    workspaceId: context.workspace_id,
    sessionId,
    reason: parsed.data.reason,
    actor: cashClosureActor(context),
    canManageOthers: canManageCashCountingSessionsOfOthers(context),
  }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : "";
    const safeMessage = message.includes("sessão") || message.includes("Sessão") ? message : "Não foi possível cancelar a sessão.";
    throw new AppError({ code: "CASH_COUNTING_SESSION_CANCEL_CONFLICT", kind: "CONFLICT", safeMessage, cause });
  });
  return NextResponse.json({ session });
});
