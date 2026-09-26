import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { budgetActor, budgetError, assertBudgetPersonnelPermission } from "@/features/financial/budgets/access.server";
import { budgetIdSchema } from "@/features/financial/budgets/schemas";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { resolveBudgetCenter, resolveBudgetEmployees, listBudgetPersonReferences } from "@/features/financial/budgets/references.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
const schema = z.object({ employeeIds: z.array(budgetIdSchema).min(1).max(100),
  month: financialCompetenceMonthSchema, resultCenterId: budgetIdSchema });
// Selected references only. This read uses POST to keep personal identifiers out of URLs/logs.
export const POST = withApiErrorHandling({ source: "api-financial", operation: "resolve-budget-person-references", routeOrJob: "/api/financial/budgets/person-references" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  assertBudgetPersonnelPermission(actor);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_PERSON_REFERENCES_INVALID", kind: "VALIDATION" });
  try {
    const center = await resolveBudgetCenter(parsed.data.resultCenterId, actor);
    const names = await resolveBudgetEmployees(parsed.data.employeeIds, parsed.data.month, actor);
    return NextResponse.json({ people: [...names].map(([employeeId, employeeName]) => ({ employeeId, employeeName, ...center })) },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { budgetError(error); }
});

export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-budget-person-references", routeOrJob: "/api/financial/budgets/person-references" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  assertBudgetPersonnelPermission(actor);
  const parsed = z.object({ resultCenterId: budgetIdSchema, cursor: budgetIdSchema.optional() }).safeParse({
    resultCenterId: request.nextUrl.searchParams.get("resultCenterId"), cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) throw new AppError({ code: "BUDGET_PERSON_REFERENCES_INVALID", kind: "VALIDATION" });
  try {
    return NextResponse.json(await listBudgetPersonReferences(actor, parsed.data.resultCenterId, parsed.data.cursor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { budgetError(error); }
});
