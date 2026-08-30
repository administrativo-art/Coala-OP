import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { processCashDepositQueue } from "@/features/financial/cash-deposits/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ kioskId: z.string().trim().min(1).max(120) });

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "allocate-cash-deposit-adjustments",
  routeOrJob: "/api/financial/cash-deposits/adjustments/allocate",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_DEPOSIT_ADJUSTMENT_ALLOCATION_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe uma unidade válida.",
      cause: parsed.error,
    });
  }
  try {
    assertCashDepositAccess(context, "adjust", parsed.data.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_DEPOSIT_ADJUSTMENT_ALLOCATION_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const result = await processCashDepositQueue(
    context.workspace_id,
    parsed.data.kioskId,
    cashClosureActor(context),
  );
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
