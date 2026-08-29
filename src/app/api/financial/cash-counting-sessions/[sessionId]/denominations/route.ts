import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  assertCashCountingSessionDepositAccess,
  canManageCashCountingSessionsOfOthers,
} from "@/features/financial/cash-counting-sessions/access.server";
import {
  confirmCashCountingSessionDenominations,
  getCashCountingSession,
} from "@/features/financial/cash-counting-sessions/repository.server";
import { confirmCashCountingDenominationsSchema } from "@/features/financial/cash-counting-sessions/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "confirm-cash-counting-denominations",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]/denominations",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = confirmCashCountingDenominationsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({ code: "CASH_COUNTING_DENOMINATIONS_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message, cause: parsed.error });
  }
  const { sessionId } = await routeContext.params;
  const current = await getCashCountingSession(sessionId);
  if (!current || current.session.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashCountingSessionDepositAccess(context, current.session);
  } catch (cause) {
    throw new AppError({ code: "CASH_COUNTING_DENOMINATIONS_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const result = await confirmCashCountingSessionDenominations({
    workspaceId: context.workspace_id,
    sessionId,
    entries: parsed.data.denominations,
    actor: cashClosureActor(context),
    canManageOthers: canManageCashCountingSessionsOfOthers(context),
  }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("total físico") || message.includes("sessão") || message.includes("Sessão")) {
      throw new AppError({
        code: "CASH_COUNTING_DENOMINATIONS_CONFLICT",
        kind: "CONFLICT",
        safeMessage: "O total físico precisa conferir com o valor elegível de uma sessão encerrada.",
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json(result);
});
