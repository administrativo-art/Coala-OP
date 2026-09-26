import { NextRequest, NextResponse } from "next/server";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { createBudgetSchema } from "@/features/financial/budgets/schemas";
import { budgetActor, budgetError, budgetCenterFilter } from "@/features/financial/budgets/access.server";
import { budgetSummaryForViewer, canViewBudgetPersonnel } from "@/features/financial/budgets/personnel-access";
import { createBudget, listBudgetSummaries } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-budgets", routeOrJob: "/api/financial/budgets" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "view");
  const parsed = financialCompetenceMonthSchema.safeParse(request.nextUrl.searchParams.get("month"));
  if (!parsed.success) throw new AppError({ code: "BUDGET_MONTH_INVALID", kind: "VALIDATION", safeMessage: "Escolha uma competência válida." });
  try {
    const budgets = await listBudgetSummaries(parsed.data, budgetCenterFilter(request), actor);
    return NextResponse.json({ budgets: budgets.map((budget) => budgetSummaryForViewer(budget, canViewBudgetPersonnel(actor))),
      limits: { budgets: 100, expensesPerMonth: 2000 } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { budgetError(error); }
});

export const POST = withApiErrorHandling({ source: "api-financial", operation: "create-budget", routeOrJob: "/api/financial/budgets" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  const parsed = createBudgetSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Revise nome, contas, competência e valor do orçamento.", cause: parsed.error });
  try {
    return NextResponse.json(await createBudget(parsed.data, actor.decoded.uid, { actor }), { status: 201 });
  } catch (error) { budgetError(error); }
});
