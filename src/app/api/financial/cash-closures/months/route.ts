import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureCatalogAccess } from "@/features/financial/cash-closures/access.server";
import { listCashClosureMonthlySummaries } from "@/features/financial/cash-closures/summaries.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-cash-closure-months",
  routeOrJob: "/api/financial/cash-closures/months",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const kioskId = request.nextUrl.searchParams.get("kioskId")?.trim();
  if (!kioskId) {
    throw new AppError({
      code: "CASH_CLOSURE_MONTHS_UNIT_REQUIRED",
      kind: "VALIDATION",
      safeMessage: "Informe a unidade.",
    });
  }
  try {
    assertCashClosureCatalogAccess(context, kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_MONTHS_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  return NextResponse.json({
    summaries: await listCashClosureMonthlySummaries(context.workspace_id, kioskId),
  }, { headers: { "Cache-Control": "private, no-store" } });
});
