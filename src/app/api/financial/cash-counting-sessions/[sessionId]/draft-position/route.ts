import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  assertCashCountingSessionClosureAccess,
  canManageCashCountingSessionsOfOthers,
} from "@/features/financial/cash-counting-sessions/access.server";
import {
  getCashCountingSession,
  saveCashCountingSessionDraftPosition,
} from "@/features/financial/cash-counting-sessions/repository.server";
import { saveCashCountingSessionDraftPositionSchema } from "@/features/financial/cash-counting-sessions/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const PATCH = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "save-cash-counting-session-draft-position",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]/draft-position",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = saveCashCountingSessionDraftPositionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_DRAFT_POSITION_INVALID",
      kind: "VALIDATION",
      safeMessage: parsed.error.issues[0]?.message ?? "Informe uma unidade e uma data válidas.",
      cause: parsed.error,
    });
  }
  const { sessionId } = await routeContext.params;
  const current = await getCashCountingSession(sessionId, { operatorLimit: 1 });
  if (!current || current.session.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashCountingSessionClosureAccess(context, "approve", current.session);
  } catch (cause) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_DRAFT_POSITION_FORBIDDEN",
      kind: "AUTHORIZATION",
      cause,
    });
  }
  const session = await saveCashCountingSessionDraftPosition({
    workspaceId: context.workspace_id,
    sessionId,
    kioskId: parsed.data.kioskId,
    date: parsed.data.date,
    actor: cashClosureActor(context),
    canManageOthers: canManageCashCountingSessionsOfOthers(context),
  }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("em uso por")) {
      throw new AppError({
        code: "CASH_COUNTING_SESSION_DRAFT_POSITION_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Esta sessão está sob responsabilidade de outra pessoa.",
        cause,
      });
    }
    throw new AppError({
      code: "CASH_COUNTING_SESSION_DRAFT_POSITION_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "A unidade não está disponível nesta sessão de contagem.",
      cause,
    });
  });
  return NextResponse.json({ session });
});
