import { NextRequest, NextResponse } from "next/server";
import { budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { updateBudgetSchema } from "@/features/financial/budgets/schemas";
import { getBudgetSummary, updateBudget } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function validId(id: string) {
  if (!id || id.length > 180 || id.includes("/")) throw new AppError({ code: "BUDGET_ID_INVALID", kind: "VALIDATION" });
  return id;
}

export const GET = withApiErrorHandling<Context>({ source: "api-financial", operation: "get-budget", routeOrJob: "/api/financial/budgets/[id]" }, async (request: NextRequest, context) => {
  await budgetActor(request, "view");
  try { return NextResponse.json({ budget: await getBudgetSummary(validId((await context.params).id)) }); }
  catch (error) { budgetError(error); }
});

export const PATCH = withApiErrorHandling<Context>({ source: "api-financial", operation: "update-budget", routeOrJob: "/api/financial/budgets/[id]" }, async (request: NextRequest, context) => {
  const actor = await budgetActor(request, "manage");
  const parsed = updateBudgetSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_UPDATE_INVALID", kind: "VALIDATION", safeMessage: "Revise os dados da alteração.", cause: parsed.error });
  try {
    await updateBudget(validId((await context.params).id), parsed.data, actor.decoded.uid);
    return NextResponse.json({ ok: true });
  } catch (error) { budgetError(error); }
});
