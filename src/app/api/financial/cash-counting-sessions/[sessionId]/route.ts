import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashCountingSessionClosureAccess } from "@/features/financial/cash-counting-sessions/access.server";
import { getCashCountingSession } from "@/features/financial/cash-counting-sessions/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "get-cash-counting-session",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { sessionId } = await routeContext.params;
  const result = await getCashCountingSession(sessionId);
  if (!result || result.session.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashCountingSessionClosureAccess(context, "view", result.session);
  } catch (cause) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
