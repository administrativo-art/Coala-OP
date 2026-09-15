import { NextRequest, NextResponse } from "next/server";

import { stoneSettlementsListQuerySchema } from "@/features/financial/stone-receivables/schemas";
import { listStoneSettlements, StoneFinancialConflictError } from "@/features/financial/stone-receivables/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { resolveUnitAccess } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-stone-settlements",
  routeOrJob: "/api/financial/stone-settlements",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const unitAccess = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.view === true
    && context.permissions.financial?.reconciliation?.view === true
    && unitAccess.allUnits
  );
  if (!allowed) throw new AppError({ code: "STONE_SETTLEMENTS_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = stoneSettlementsListQuerySchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
    cursor: request.nextUrl.searchParams.get("cursor") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    throw new AppError({
      code: "STONE_SETTLEMENTS_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe período e paginação válidos.",
      cause: parsed.error,
    });
  }
  const result = await listStoneSettlements({ workspaceId: context.workspace_id, ...parsed.data }).catch((cause) => {
    if (cause instanceof StoneFinancialConflictError) {
      throw new AppError({ code: "STONE_SETTLEMENTS_CURSOR_INVALID", kind: "VALIDATION", safeMessage: cause.message, cause });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
