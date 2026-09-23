import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import { runManagementAnalysis } from "@/features/financial/agent/management.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
export const POST = withApiErrorHandling({ source: "api-financial", operation: "management-analysis", routeOrJob: "/api/financial/management-analysis" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => { throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" }); });
  if (!context.isDefaultAdmin) throw new AppError({ code: "FINANCIAL_MANAGEMENT_FORBIDDEN", kind: "AUTHORIZATION" });
  const result = await runManagementAnalysis(await readSalesReviewBody(request), context,
    AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
