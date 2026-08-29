import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositBatchAccess } from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { cancelInterCobrancaForBatch } from "@/features/financial/cash-deposits/inter-service.server";
import { cancelCashDepositSchema } from "@/features/financial/cash-deposits/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ batchId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "cancel-cash-deposit",
  routeOrJob: "/api/financial/cash-deposits/[batchId]/cancel",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { batchId } = await routeContext.params;
  const current = await getCashDepositBatch(batchId);
  if (!current || current.batch.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashDepositBatchAccess(context, "cancel", current.batch);
  } catch (cause) {
    throw new AppError({ code: "CASH_DEPOSIT_CANCEL_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const parsed = cancelCashDepositSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_DEPOSIT_CANCEL_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe um motivo de cancelamento com até 50 caracteres.",
      cause: parsed.error,
    });
  }
  const result = await cancelInterCobrancaForBatch({
    workspaceId: context.workspace_id,
    batchId,
    reason: parsed.data.reason,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
