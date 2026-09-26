import { NextRequest, NextResponse } from "next/server";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { budgetActor, budgetError, budgetCenterFilter } from "@/features/financial/budgets/access.server";
import { generateBudgetMonth } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const POST = withApiErrorHandling({ source: "api-financial", operation: "generate-budget-month", routeOrJob: "/api/financial/budget-rules/generate" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  const body = await request.json();
  const parsed = financialCompetenceMonthSchema.safeParse(body?.month);
  if (!parsed.success) throw new AppError({ code: "BUDGET_GENERATION_MONTH_INVALID", kind: "VALIDATION", safeMessage: "Escolha um mês válido." });
  try { return NextResponse.json({ results: await generateBudgetMonth(parsed.data, actor.decoded.uid, { actor, resultCenterId: budgetCenterFilter(request) }) }); }
  catch (error) { budgetError(error); }
});
