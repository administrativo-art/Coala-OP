import { NextRequest, NextResponse } from "next/server";

import { salesReconciliationPeriodActionSchema } from "@/features/financial/sales-reconciliation/schemas";
import {
  changeSalesReconciliationPeriodStatus,
  SalesReconciliationAccessError,
  SalesReconciliationConflictError,
  SalesReconciliationNotFoundError,
  SalesReconciliationStateError,
} from "@/features/financial/sales-reconciliation/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

type RouteContext = { params: Promise<{ periodId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "close-sales-reconciliation-period",
  routeOrJob: "/api/financial/sales-reconciliation/periods/[periodId]/close",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.close === true
  );
  if (!allowed) throw new AppError({ code: "SALES_RECONCILIATION_CLOSE_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = salesReconciliationPeriodActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "SALES_RECONCILIATION_CLOSE_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe o motivo do fechamento.",
      cause: parsed.error,
    });
  }
  const { periodId } = await routeContext.params;
  const actorName = context.userDoc.username?.trim() || context.decoded.name?.trim() || context.decoded.email || "Usuário";
  const result = await changeSalesReconciliationPeriodStatus({
    periodId,
    workspaceId: context.workspace_id,
    action: "close",
    reason: parsed.data.reason,
    actor: { id: context.decoded.uid, name: actorName },
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  }).catch((cause) => {
    if (cause instanceof SalesReconciliationNotFoundError) {
      throw new AppError({ code: "SALES_RECONCILIATION_PERIOD_NOT_FOUND", kind: "NOT_FOUND", cause });
    }
    if (cause instanceof SalesReconciliationAccessError) {
      throw new AppError({ code: "SALES_RECONCILIATION_UNIT_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    if (cause instanceof SalesReconciliationConflictError || cause instanceof SalesReconciliationStateError) {
      throw new AppError({
        code: "SALES_RECONCILIATION_CLOSE_CONFLICT",
        kind: "CONFLICT",
        safeMessage: cause.message,
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
