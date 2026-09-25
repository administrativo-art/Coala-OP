import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { budgetActor, budgetError, validBudgetDocumentId } from "@/features/financial/budgets/access.server";
import { linkProjectExpense, unlinkProjectExpense } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const expenseIdSchema = z.string().trim().min(1).max(180).refine((id) => !id.includes("/"));
export const POST = withApiErrorHandling<Context>({ source: "api-financial", operation: "link-budget-project-expense", routeOrJob: "/api/financial/budget-projects/[id]/expenses" }, async (request: NextRequest, context) => {
  const actor = await budgetActor(request, "manage");
  const parsed = expenseIdSchema.safeParse((await request.json())?.expenseId);
  if (!parsed.success) throw new AppError({ code: "BUDGET_PROJECT_EXPENSE_INVALID", kind: "VALIDATION" });
  try { await linkProjectExpense(validBudgetDocumentId((await context.params).id), parsed.data, actor.decoded.uid); return NextResponse.json({ ok: true }); }
  catch (error) { budgetError(error); }
});
export const DELETE = withApiErrorHandling<Context>({ source: "api-financial", operation: "unlink-budget-project-expense", routeOrJob: "/api/financial/budget-projects/[id]/expenses" }, async (request: NextRequest, context) => {
  const actor = await budgetActor(request, "manage");
  const parsed = expenseIdSchema.safeParse(request.nextUrl.searchParams.get("expenseId"));
  if (!parsed.success) throw new AppError({ code: "BUDGET_PROJECT_EXPENSE_INVALID", kind: "VALIDATION" });
  try { await unlinkProjectExpense(validBudgetDocumentId((await context.params).id), parsed.data, actor.decoded.uid); return NextResponse.json({ ok: true }); }
  catch (error) { budgetError(error); }
});
