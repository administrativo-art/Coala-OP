import { NextRequest, NextResponse } from "next/server";

import { cashDifferenceListQuerySchema } from "@/features/financial/cash-differences/schemas";
import { CashDifferenceError, listCashClosureDifferences } from "@/features/financial/cash-differences/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-cash-differences",
  routeOrJob: "/api/financial/cash-differences",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.view === true
    && context.permissions.financial?.cashClosures?.view === true
  );
  if (!allowed) throw new AppError({ code: "CASH_DIFFERENCES_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = cashDifferenceListQuerySchema.safeParse({
    kioskId: request.nextUrl.searchParams.get("kioskId"),
    period: request.nextUrl.searchParams.get("period"),
  });
  if (!parsed.success) throw new AppError({ code: "CASH_DIFFERENCES_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Informe unidade e competência válidas.", cause: parsed.error });
  if (!canAccessUnit(context.userDoc, parsed.data.kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: "CASH_DIFFERENCES_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const result = await listCashClosureDifferences({ workspaceId: context.workspace_id, ...parsed.data }).catch((cause) => {
    if (cause instanceof CashDifferenceError) throw new AppError({ code: `CASH_DIFFERENCES_${cause.code}`, kind: "CONFLICT", safeMessage: cause.message, cause });
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
