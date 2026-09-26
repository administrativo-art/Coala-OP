import { NextRequest, NextResponse } from "next/server";
import { projectBudgetActor as budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { createBudgetProjectSchema } from "@/features/financial/budgets/schemas";
import { createBudgetProject, listBudgetProjects } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-budget-projects", routeOrJob: "/api/financial/budget-projects" }, async (request: NextRequest) => {
  await budgetActor(request, "view");
  try { return NextResponse.json({ projects: await listBudgetProjects() }); }
  catch (error) { budgetError(error); }
});
export const POST = withApiErrorHandling({ source: "api-financial", operation: "create-budget-project", routeOrJob: "/api/financial/budget-projects" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  const parsed = createBudgetProjectSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_PROJECT_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Revise nome, contas, período e limite do projeto.", cause: parsed.error });
  try { return NextResponse.json(await createBudgetProject(parsed.data, actor.decoded.uid), { status: 201 }); }
  catch (error) { budgetError(error); }
});
