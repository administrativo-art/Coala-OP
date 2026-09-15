import { NextRequest, NextResponse } from "next/server";

import { salesReconciliationDecisionSchema } from "@/features/financial/sales-reconciliation/schemas";
import {
  decideSalesReconciliationCase,
  SalesReconciliationAccessError,
  SalesReconciliationConflictError,
  SalesReconciliationNotFoundError,
  SalesReconciliationStateError,
} from "@/features/financial/sales-reconciliation/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

type RouteContext = { params: Promise<{ caseId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "decide-sales-reconciliation-case",
  routeOrJob: "/api/financial/sales-reconciliation/cases/[caseId]/decision",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = salesReconciliationDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "SALES_RECONCILIATION_DECISION_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe uma decisão e uma justificativa válidas.",
      cause: parsed.error,
    });
  }
  const permissions = context.permissions.financial?.salesReconciliation;
  const canDecide = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && permissions?.review === true
    && (parsed.data.action !== "classify" || permissions.classify === true)
  );
  if (!canDecide) {
    throw new AppError({ code: "SALES_RECONCILIATION_DECISION_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const { caseId } = await routeContext.params;
  const actorName = context.userDoc.username?.trim()
    || context.decoded.name?.trim()
    || context.decoded.email
    || "Usuário";
  const result = await decideSalesReconciliationCase({
    caseId,
    workspaceId: context.workspace_id,
    decision: parsed.data,
    actor: { id: context.decoded.uid, name: actorName },
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  }).catch((cause) => {
    if (cause instanceof SalesReconciliationNotFoundError) {
      throw new AppError({ code: "SALES_RECONCILIATION_CASE_NOT_FOUND", kind: "NOT_FOUND", cause });
    }
    if (cause instanceof SalesReconciliationAccessError) {
      throw new AppError({ code: "SALES_RECONCILIATION_UNIT_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    if (cause instanceof SalesReconciliationConflictError || cause instanceof SalesReconciliationStateError) {
      throw new AppError({
        code: "SALES_RECONCILIATION_DECISION_CONFLICT",
        kind: "CONFLICT",
        safeMessage: cause.message,
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
