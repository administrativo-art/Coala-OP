import { NextRequest, NextResponse } from "next/server";
import { budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { listBudgetComparisonCenters } from "@/features/financial/budgets/comparison.server";
import { withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrorHandling({ source: "api-financial", operation: "budget-comparison-centers", routeOrJob: "/api/financial/budgets/centers" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "view");
  try { return NextResponse.json(await listBudgetComparisonCenters(actor), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { budgetError(error); }
});
