import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { getCashClosure, listCashClosureAuditLogs } from "@/features/financial/cash-closures/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ closureId: string }> };

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "list-cash-closure-audit",
  routeOrJob: "/api/financial/cash-closures/[closureId]/audit",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { closureId } = await routeContext.params;
  const current = await getCashClosure(closureId);
  if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
  try {
    assertCashClosureAccess(context, "view", current.closure.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_AUDIT_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  return NextResponse.json({ logs: await listCashClosureAuditLogs(context.workspace_id, closureId) });
});
