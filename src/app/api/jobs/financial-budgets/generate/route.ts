import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { generateScheduledBudgetMonths } from "@/features/financial/budgets/service.server";
import { budgetError } from "@/features/financial/budgets/access.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({ source: "api-financial", operation: "scheduled-budget-generation", routeOrJob: "/api/jobs/financial-budgets/generate" }, async (request: NextRequest) => {
  const expected = process.env.FINANCIAL_BUDGET_SCHEDULER_SECRET;
  const provided = request.headers.get("x-financial-budget-scheduler-secret");
  if (!expected || !provided || !timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(provided).digest(),
  )) throw new AppError({ code: "BUDGET_SCHEDULER_UNAUTHORIZED", kind: "AUTHENTICATION" });
  const month = financialDateKey(new Date())!.slice(0, 7);
  try { return NextResponse.json({ month, results: await generateScheduledBudgetMonths(month, "system:financial-budget-scheduler") }); }
  catch (error) { budgetError(error); }
});
