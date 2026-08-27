import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ batchId: string }> };

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "get-cash-deposit",
  routeOrJob: "/api/financial/cash-deposits/[batchId]",
}, async (request, routeContext) => {
    const context = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const { batchId } = await routeContext.params;
    const result = await getCashDepositBatch(batchId);
    if (!result) {
      throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
    }
    try {
      assertCashDepositAccess(context, "view", result.batch.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_DEPOSIT_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
