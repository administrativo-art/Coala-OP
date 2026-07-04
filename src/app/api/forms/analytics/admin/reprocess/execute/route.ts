import { type NextRequest, NextResponse } from "next/server";

import {
  AnalyticsAdminInputError,
  analyticsAdminErrorResponse,
  buildReprocessScope,
  createExecutionLoader,
  parseLocalDateRange,
  type ReprocessScopeInput,
} from "@/features/forms/analytics/admin-operations";
import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import { recomputeDailyMetricsRange } from "@/features/forms/analytics/daily-aggregates";
import {
  executeReprocess,
  type SimulationReport,
} from "@/features/forms/analytics/reprocess-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExecuteBody = ReprocessScopeInput & {
  simulation?: SimulationReport;
  simulatedAt?: string;
  recomputeAggregates?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "reprocess_occurrences");
    const body = (await request.json().catch(() => ({}))) as ExecuteBody;
    if (!body.simulation || !body.simulatedAt) {
      throw new AnalyticsAdminInputError(
        "Envie simulation e simulatedAt retornados pela simulação."
      );
    }

    const scope = await buildReprocessScope(context.db, context.workspaceId, body);
    const results = await executeReprocess(
      { db: context.db, executionsCollection: "form_executions" },
      scope,
      createExecutionLoader(context.db, context.workspaceId),
      {
        simulation: body.simulation,
        simulatedAt: new Date(body.simulatedAt),
        confirmedBy: context.userId,
      }
    );

    let aggregates: Awaited<ReturnType<typeof recomputeDailyMetricsRange>> | null = null;
    if (body.recomputeAggregates !== false) {
      const range = parseLocalDateRange(body, { defaultDays: 30, maxDays: 400 });
      aggregates = await recomputeDailyMetricsRange(
        context.db,
        context.workspaceId,
        range.fromLocalDate,
        range.toLocalDate
      );
    }

    return NextResponse.json({ results, aggregates });
  } catch (error) {
    if (error instanceof AnalyticsAdminInputError) {
      return analyticsAdminErrorResponse(error);
    }
    return taxonomyErrorResponse(error, "Falha ao executar reprocessamento.");
  }
}
