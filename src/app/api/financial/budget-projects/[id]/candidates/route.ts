import { NextRequest, NextResponse } from "next/server";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { budgetActor, budgetError, validBudgetDocumentId } from "@/features/financial/budgets/access.server";
import { listProjectCandidates } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = withApiErrorHandling<Context>({ source: "api-financial", operation: "list-budget-project-candidates", routeOrJob: "/api/financial/budget-projects/[id]/candidates" }, async (request: NextRequest, context) => {
  await budgetActor(request, "manage");
  const parsed = financialCompetenceMonthSchema.safeParse(request.nextUrl.searchParams.get("month"));
  if (!parsed.success) throw new AppError({ code: "BUDGET_PROJECT_MONTH_INVALID", kind: "VALIDATION" });
  const search = request.nextUrl.searchParams.get("search")?.trim().slice(0, 80) ?? "";
  try { return NextResponse.json({ expenses: await listProjectCandidates(validBudgetDocumentId((await context.params).id), parsed.data, search) }); }
  catch (error) { budgetError(error); }
});
