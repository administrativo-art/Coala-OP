import { NextRequest, NextResponse } from "next/server";
import { budgetActor, budgetError, validBudgetDocumentId } from "@/features/financial/budgets/access.server";
import { updateBudgetProjectSchema } from "@/features/financial/budgets/schemas";
import { getBudgetProjectSummary, updateBudgetProject } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = withApiErrorHandling<Context>({ source: "api-financial", operation: "get-budget-project", routeOrJob: "/api/financial/budget-projects/[id]" }, async (request: NextRequest, context) => {
  await budgetActor(request, "view");
  try { return NextResponse.json({ project: await getBudgetProjectSummary(validBudgetDocumentId((await context.params).id)) }); }
  catch (error) { budgetError(error); }
});
export const PATCH = withApiErrorHandling<Context>({ source: "api-financial", operation: "update-budget-project", routeOrJob: "/api/financial/budget-projects/[id]" }, async (request: NextRequest, context) => {
  const actor = await budgetActor(request, "manage");
  const parsed = updateBudgetProjectSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_PROJECT_UPDATE_INVALID", kind: "VALIDATION", safeMessage: "Revise a alteração do projeto." });
  try { await updateBudgetProject(validBudgetDocumentId((await context.params).id), parsed.data, actor.decoded.uid); return NextResponse.json({ ok: true }); }
  catch (error) { budgetError(error); }
});
