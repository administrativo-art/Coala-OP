import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { salesReconciliationListQuerySchema } from "@/features/financial/sales-reconciliation/schemas";
import {
  listSalesReconciliationCases,
  SalesReconciliationLimitError,
} from "@/features/financial/sales-reconciliation/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-sales-reconciliation",
  routeOrJob: "/api/financial/sales-reconciliation",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const canView = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.view === true
  );
  if (!canView) {
    throw new AppError({ code: "SALES_RECONCILIATION_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const parsed = salesReconciliationListQuerySchema.safeParse({
    period: request.nextUrl.searchParams.get("period"),
    kioskId: request.nextUrl.searchParams.get("kioskId") || undefined,
    status: request.nextUrl.searchParams.get("status") || undefined,
    cursor: request.nextUrl.searchParams.get("cursor") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    throw new AppError({
      code: "SALES_RECONCILIATION_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe competência, filtros e paginação válidos.",
      cause: parsed.error,
    });
  }
  if (
    parsed.data.kioskId
    && !canAccessUnit(context.userDoc, parsed.data.kioskId, { isDefaultAdmin: context.isDefaultAdmin })
  ) {
    throw new AppError({ code: "SALES_RECONCILIATION_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
  }

  const result = await listSalesReconciliationCases({
    workspaceId: context.workspace_id,
    ...parsed.data,
  }).catch((cause) => {
    if (cause instanceof SalesReconciliationLimitError) {
      throw new AppError({
        code: "SALES_RECONCILIATION_LIMIT_EXCEEDED",
        kind: "CONFLICT",
        safeMessage: "A consulta ultrapassa o limite seguro da conciliação.",
        cause,
        metadata: { limitSource: cause.source },
      });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
