import { NextRequest, NextResponse } from "next/server";
import { budgetActor, budgetError, assertBudgetPersonnelPermission, validBudgetDocumentId } from "@/features/financial/budgets/access.server";
import { budgetCoverageSchema } from "@/features/financial/budgets/schemas";
import { confirmBudgetCoverage } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const POST = withApiErrorHandling<Context>({ source: "api-financial", operation: "confirm-budget-coverage", routeOrJob: "/api/financial/budgets/[id]/coverage" }, async (request: NextRequest, context) => {
  const actor = await budgetActor(request, "manage");
  assertBudgetPersonnelPermission(actor);
  const parsed = budgetCoverageSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_COVERAGE_INVALID", kind: "VALIDATION", safeMessage: "Confirme documentos, pessoa, cobertura e motivo." });
  try {
    await confirmBudgetCoverage(validBudgetDocumentId((await context.params).id), parsed.data, actor.decoded.uid, actor);
    return NextResponse.json({ ok: true });
  } catch (error) { budgetError(error); }
});
