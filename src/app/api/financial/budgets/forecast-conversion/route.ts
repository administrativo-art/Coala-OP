import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { budgetActor, budgetError } from "@/features/financial/budgets/access.server";
import { forecastConversionSchema } from "@/features/financial/budgets/forecast-conversion";
import { assertForecastConversionActor, convertForecastsToBudgets, listForecastConversionCandidates } from "@/features/financial/budgets/forecast-conversion.server";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
const schema = z.object({ input: forecastConversionSchema,
  confirmation: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).optional() });
export const GET = withApiErrorHandling({ source: "api-financial", operation: "preview-vt-forecasts", routeOrJob: "/api/financial/budgets/forecast-conversion" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  assertForecastConversionActor(actor);
  const month = financialCompetenceMonthSchema.safeParse(request.nextUrl.searchParams.get("month"));
  if (!month.success) throw new AppError({ code: "BUDGET_MONTH_INVALID", kind: "VALIDATION" });
  try { return NextResponse.json({ candidates: await listForecastConversionCandidates(month.data, actor) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { budgetError(error); }
});
export const POST = withApiErrorHandling({ source: "api-financial", operation: "convert-vt-forecasts", routeOrJob: "/api/financial/budgets/forecast-conversion" }, async (request: NextRequest) => {
  const actor = await budgetActor(request, "manage");
  assertForecastConversionActor(actor);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new AppError({ code: "BUDGET_CONVERSION_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Confira origem, destinos e motivo." });
  try { return NextResponse.json(await convertForecastsToBudgets(parsed.data.input, actor, parsed.data.confirmation), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { budgetError(error); }
});
