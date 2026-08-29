import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { syncCashClosureSchema } from "@/features/financial/cash-closures/schemas";
import { syncCashClosure } from "@/features/financial/cash-closures/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "sync-cash-closure",
  routeOrJob: "/api/financial/cash-closures/sync",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = syncCashClosureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_CLOSURE_SYNC_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe uma unidade e uma data válidas.",
      cause: parsed.error,
    });
  }
  try {
    assertCashClosureAccess(context, "resync", parsed.data.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_SYNC_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const result = await syncCashClosure({
    workspaceId: context.workspace_id,
    kioskId: parsed.data.kioskId,
    date: parsed.data.date,
    actor: cashClosureActor(context),
  });
  return NextResponse.json({
    closure: result.closure,
    lines: result.lines,
    operators: result.operators,
    created: result.created,
    sourceChanged: result.sourceChanged,
  });
});
