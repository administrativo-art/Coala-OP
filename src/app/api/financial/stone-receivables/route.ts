import { NextRequest, NextResponse } from "next/server";

import { stoneReceivablesListQuerySchema } from "@/features/financial/stone-receivables/schemas";
import { listStoneReceivables, StoneFinancialConflictError } from "@/features/financial/stone-receivables/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-stone-receivables",
  routeOrJob: "/api/financial/stone-receivables",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.view === true
  );
  if (!allowed) throw new AppError({ code: "STONE_RECEIVABLES_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = stoneReceivablesListQuerySchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
    kioskId: request.nextUrl.searchParams.get("kioskId") || undefined,
    status: request.nextUrl.searchParams.get("status") || undefined,
    cursor: request.nextUrl.searchParams.get("cursor") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    throw new AppError({
      code: "STONE_RECEIVABLES_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe período, filtros e paginação válidos.",
      cause: parsed.error,
    });
  }
  if (parsed.data.kioskId && !canAccessUnit(context.userDoc, parsed.data.kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: "STONE_RECEIVABLES_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const result = await listStoneReceivables({
    workspaceId: context.workspace_id,
    ...parsed.data,
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
    canViewUnmapped: context.isDefaultAdmin || context.permissions.financial?.stoneIntegration?.manage === true,
  }).catch((cause) => {
    if (cause instanceof StoneFinancialConflictError) {
      throw new AppError({ code: "STONE_RECEIVABLES_CURSOR_INVALID", kind: "VALIDATION", safeMessage: cause.message, cause });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
