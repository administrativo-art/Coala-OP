import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { budgetIdSchema } from "@/features/financial/budgets/schemas";
import { getBudgetCashProjections } from "@/features/financial/budgets/projections.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => {
  const parsed = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
});
export const GET = withApiErrorHandling({ source: "api-financial", operation: "budget-cash-projections", routeOrJob: "/api/financial/budgets/cash-projections" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "view");
  if (!actor.isDefaultAdmin && !actor.permissions.financial?.cashFlow?.view) throw new AppError({ code: "BUDGET_CASH_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = z.object({ from: date, to: date, resultCenterId: budgetIdSchema.optional() }).safeParse({
    from: request.nextUrl.searchParams.get("from"), to: request.nextUrl.searchParams.get("to"), resultCenterId: request.nextUrl.searchParams.get("resultCenterId") ?? undefined,
  });
  if (!parsed.success) throw new AppError({ code: "BUDGET_CASH_QUERY_INVALID", kind: "VALIDATION" });
  try { return NextResponse.json(await getBudgetCashProjections(actor, parsed.data), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { budgetError(error); }
});
