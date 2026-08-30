import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositBatchAccess } from "@/features/financial/cash-closures/access.server";
import { getInterCobrancaForBatch, refreshInterCobranca } from "@/features/financial/cash-deposits/inter-service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ batchId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "refresh-cash-deposit",
  routeOrJob: "/api/financial/cash-deposits/[batchId]/refresh",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { batchId } = await routeContext.params;
  const current = await getInterCobrancaForBatch(batchId);
  if (!current || current.batch.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashDepositBatchAccess(context, "view", current.batch);
  } catch (cause) {
    throw new AppError({ code: "CASH_DEPOSIT_REFRESH_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  if (!current.cobranca) {
    throw new AppError({
      code: "CASH_DEPOSIT_NOT_ISSUED",
      kind: "CONFLICT",
      safeMessage: "Este bloco ainda não possui cobrança Inter.",
    });
  }
  const result = await refreshInterCobranca(current.cobranca.id);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
