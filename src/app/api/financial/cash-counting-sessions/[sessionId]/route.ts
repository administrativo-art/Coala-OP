import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { assertCashCountingSessionClosureAccess } from "@/features/financial/cash-counting-sessions/access.server";
import { getCashCountingSession } from "@/features/financial/cash-counting-sessions/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  afterFinalizedAt: z.string().datetime({ offset: true }).optional(),
  afterId: z.string().trim().min(1).max(500).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.afterFinalizedAt) !== Boolean(value.afterId)) {
    context.addIssue({ code: "custom", message: "O cursor de operadores está incompleto." });
  }
});

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "get-cash-counting-session",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { sessionId } = await routeContext.params;
  const parsed = querySchema.safeParse({
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    afterFinalizedAt: request.nextUrl.searchParams.get("afterFinalizedAt") ?? undefined,
    afterId: request.nextUrl.searchParams.get("afterId") ?? undefined,
  });
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: parsed.error.issues[0]?.message ?? "Paginação inválida.",
      cause: parsed.error,
    });
  }
  const result = await getCashCountingSession(sessionId, {
    operatorLimit: parsed.data.limit,
    operatorCursor: parsed.data.afterFinalizedAt && parsed.data.afterId
      ? { finalizedAt: parsed.data.afterFinalizedAt, id: parsed.data.afterId }
      : null,
  });
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
