import { NextRequest, NextResponse } from "next/server";
import { budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { updateBudgetRuleSchema } from "@/features/financial/budgets/schemas";
import { updateBudgetRule } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const PATCH = withApiErrorHandling<Context>({ source: "api-financial", operation: "update-budget-rule", routeOrJob: "/api/financial/budget-rules/[id]" }, async (request: NextRequest, context) => {
  const actor = await budgetActor(request, "manage");
  const id = (await context.params).id;
  if (!id || id.length > 180 || id.includes("/")) throw new AppError({ code: "BUDGET_RULE_ID_INVALID", kind: "VALIDATION" });
  const parsed = updateBudgetRuleSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_RULE_UPDATE_INVALID", kind: "VALIDATION", safeMessage: "Revise a alteração da regra." });
  try { await updateBudgetRule(id, parsed.data, actor.decoded.uid); return NextResponse.json({ ok: true }); }
  catch (error) { budgetError(error); }
});
