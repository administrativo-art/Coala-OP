import { NextRequest, NextResponse } from "next/server";
import { projectBudgetActor, budgetError, validBudgetDocumentId } from "@/features/financial/budgets/access.server";
import { projectStageClosureSchema } from "@/features/financial/budgets/schemas";
import { closeProjectStage } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const POST = withApiErrorHandling<Context>({ source: "api-financial", operation: "budget-project-stage", routeOrJob: "/api/financial/budget-projects/[id]/stages" }, async (request: NextRequest, context) => {
  const actor = await projectBudgetActor(request, "manage");
  const parsed = projectStageClosureSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_PROJECT_STAGE_INVALID", kind: "VALIDATION", safeMessage: "Confirme a etapa e informe o motivo." });
  try { await closeProjectStage(validBudgetDocumentId((await context.params).id), parsed.data, actor.decoded.uid); return NextResponse.json({ ok: true }); }
  catch (error) { budgetError(error); }
});
