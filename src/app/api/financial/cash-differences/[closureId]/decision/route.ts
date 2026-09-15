import { NextRequest, NextResponse } from "next/server";

import { cashClosureIdSchema, cashDifferenceDecisionSchema } from "@/features/financial/cash-differences/schemas";
import { CashDifferenceError, decideCashClosureDifference } from "@/features/financial/cash-differences/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "decide-cash-difference",
  routeOrJob: "/api/financial/cash-differences/[closureId]/decision",
}, async (request: NextRequest, routeContext: { params: Promise<{ closureId: string }> }) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.classify === true
    && context.permissions.financial?.cashClosures?.view === true
  );
  if (!allowed) throw new AppError({ code: "CASH_DIFFERENCE_DECISION_FORBIDDEN", kind: "AUTHORIZATION" });
  const { closureId: rawClosureId } = await routeContext.params;
  const closureId = cashClosureIdSchema.safeParse(rawClosureId);
  const body = await request.json().catch((cause) => {
    throw new AppError({ code: "CASH_DIFFERENCE_BODY_INVALID", kind: "VALIDATION", safeMessage: "Envie uma classificação válida.", cause });
  });
  const parsed = cashDifferenceDecisionSchema.safeParse(body);
  if (!closureId.success || !parsed.success) throw new AppError({ code: "CASH_DIFFERENCE_DECISION_INVALID", kind: "VALIDATION", safeMessage: "Revise a classificação, a conta e a justificativa.", cause: parsed.success ? closureId.error : parsed.error });
  const result = await decideCashClosureDifference({
    workspaceId: context.workspace_id,
    closureId: closureId.data,
    ...parsed.data,
    actor: {
      id: context.decoded.uid,
      name: context.userDoc.username?.trim() || context.decoded.name?.trim() || null,
      email: context.userDoc.email ?? context.decoded.email ?? null,
    },
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  }).catch((cause) => {
    if (cause instanceof CashDifferenceError) {
      throw new AppError({
        code: `CASH_DIFFERENCE_${cause.code}`,
        kind: cause.code === "NOT_FOUND" ? "NOT_FOUND" : cause.code === "ACCESS" ? "AUTHORIZATION" : "CONFLICT",
        safeMessage: cause.message,
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
