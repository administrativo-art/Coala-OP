import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import { actFinancialRoutine, listFinancialRoutines } from "@/features/financial/agent/routines.server";
export const runtime = "nodejs";
export const maxDuration = 150;
export const dynamic = "force-dynamic";
async function admin(request: NextRequest) {
  const context = await requireUser(request).catch(() => { throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" }); });
  if (!context.isDefaultAdmin) throw new AppError({ code: "FINANCIAL_ROUTINE_FORBIDDEN", kind: "AUTHORIZATION" });
  return context;
}
const headers = { "Cache-Control": "private, no-store" };
export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-financial-routines", routeOrJob: "/api/financial/analysis-routines" }, async (request: NextRequest) => {
  const context = await admin(request);
  return NextResponse.json({ items: await listFinancialRoutines(context.workspace_id) }, { headers });
});
export const POST = withApiErrorHandling({ source: "api-financial", operation: "act-financial-routine", routeOrJob: "/api/financial/analysis-routines" }, async (request: NextRequest) => {
  const context = await admin(request);
  return NextResponse.json(await actFinancialRoutine(await readSalesReviewBody(request), context, context.userDoc.id), { headers });
});
