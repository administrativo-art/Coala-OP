import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { createBudgetRuleSchema } from "@/features/financial/budgets/schemas";
import { previewBudgetRule } from "@/features/financial/budgets/service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
const previewSchema = z.object({ rule: createBudgetRuleSchema, month: financialCompetenceMonthSchema });
export const POST = withApiErrorHandling({ source: "api-financial", operation: "preview-budget-rule", routeOrJob: "/api/financial/budget-rules/preview" }, async (request: NextRequest) => {
  await budgetActor(request, "manage");
  const parsed = previewSchema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_PREVIEW_INVALID", kind: "VALIDATION", safeMessage: "Revise os dados para a prévia." });
  try { return NextResponse.json(await previewBudgetRule(parsed.data.rule, parsed.data.month)); }
  catch (error) { budgetError(error); }
});
