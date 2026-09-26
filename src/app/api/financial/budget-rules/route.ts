import { NextRequest, NextResponse } from "next/server";
import { budgetActor, budgetError, budgetCenterFilter } from "@/features/financial/budgets/access.server";
import { budgetRuleForViewer, canViewBudgetPersonnel } from "@/features/financial/budgets/personnel-access";
import { createBudgetRuleSchema } from "@/features/financial/budgets/schemas";
import { createBudgetRule, listBudgetRules } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-budget-rules", routeOrJob: "/api/financial/budget-rules" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "view");
  const active = request.nextUrl.searchParams.get("active");
  if (active !== null && active !== "true" && active !== "false") throw new AppError({ code: "BUDGET_RULE_FILTER_INVALID", kind: "VALIDATION" });
  try { return NextResponse.json({ rules: (await listBudgetRules({ actor, resultCenterId: budgetCenterFilter(request), active: active !== "false" }))
    .map((rule) => budgetRuleForViewer(rule, canViewBudgetPersonnel(actor))), limits: { rules: 100 } }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { budgetError(error); }
});
export const POST = withApiErrorHandling({ source: "api-financial", operation: "create-budget-rule", routeOrJob: "/api/financial/budget-rules" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  const parsed = createBudgetRuleSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_RULE_INVALID", kind: "VALIDATION", safeMessage: "Revise a configuração automática.", cause: parsed.error });
  try { return NextResponse.json(await createBudgetRule(parsed.data, actor.decoded.uid, actor), { status: 201 }); }
  catch (error) { budgetError(error); }
});
