import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { WORKSPACE_ID } from "@/lib/workspace";
import { runDueFinancialRoutine } from "@/features/financial/agent/routines.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
export const POST = withApiErrorHandling({ source: "api-financial", operation: "scheduled-financial-analysis", routeOrJob: "/api/financial/analysis-routines/scheduler" }, async (request: NextRequest) => {
  const expected = process.env.FINANCIAL_ANALYSIS_SCHEDULER_SECRET;
  const provided = request.headers.get("x-financial-scheduler-secret");
  if (process.env.FINANCIAL_ANALYSIS_SCHEDULER_ENABLED !== "true" || !expected || !provided
    || !timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(provided).digest())) {
    throw new AppError({ code: "FINANCIAL_SCHEDULER_UNAUTHORIZED", kind: "AUTHENTICATION" });
  }
  return NextResponse.json(await runDueFinancialRoutine(WORKSPACE_ID), { headers: { "Cache-Control": "private, no-store" } });
});
