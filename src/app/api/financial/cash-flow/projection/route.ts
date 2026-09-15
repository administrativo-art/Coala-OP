import { NextRequest, NextResponse } from "next/server";

import { cashFlowProjectionQuerySchema } from "@/features/financial/cash-flow/schemas";
import { CashFlowProjectionLimitError, getCashFlowProjection } from "@/features/financial/cash-flow/projection.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-cash-flow-projection",
  routeOrJob: "/api/financial/cash-flow/projection",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && (context.permissions.financial?.cashFlow?.view === true || context.permissions.financial?.financialFlow === true)
  );
  if (!allowed) throw new AppError({ code: "CASH_FLOW_PROJECTION_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = cashFlowProjectionQuerySchema.safeParse({
    asOf: request.nextUrl.searchParams.get("asOf"),
    days: request.nextUrl.searchParams.get("days") || undefined,
    scope: request.nextUrl.searchParams.get("scope") || undefined,
    scopeId: request.nextUrl.searchParams.get("scopeId") || undefined,
  });
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_FLOW_PROJECTION_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe data, horizonte e visão válidos.",
      cause: parsed.error,
    });
  }
  if (
    parsed.data.scope === "unit"
    && !canAccessUnit(context.userDoc, parsed.data.scopeId!, { isDefaultAdmin: context.isDefaultAdmin })
  ) {
    throw new AppError({ code: "CASH_FLOW_PROJECTION_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const scope = parsed.data.scope === "consolidated"
    ? { type: "consolidated" as const }
    : { type: parsed.data.scope, id: parsed.data.scopeId! };
  const result = await getCashFlowProjection({
    workspaceId: context.workspace_id,
    asOf: parsed.data.asOf,
    days: parsed.data.days,
    scope,
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  }).catch((cause) => {
    if (cause instanceof CashFlowProjectionLimitError) {
      throw new AppError({
        code: "CASH_FLOW_PROJECTION_LIMIT_EXCEEDED",
        kind: "CONFLICT",
        safeMessage: "O volume ultrapassa o limite seguro da projeção de caixa.",
        cause,
        metadata: { source: cause.source },
      });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
