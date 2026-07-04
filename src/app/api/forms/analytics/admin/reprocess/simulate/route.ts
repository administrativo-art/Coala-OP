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
import { simulateReprocess } from "@/features/forms/analytics/reprocess-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "reprocess_occurrences");
    const body = (await request.json().catch(() => ({}))) as ReprocessScopeInput;
    const scope = await buildReprocessScope(context.db, context.workspaceId, body);
    const simulation = await simulateReprocess(
      context.db,
      scope,
      createExecutionLoader(context.db, context.workspaceId)
    );
    const range = parseLocalDateRange(body, { defaultDays: 30, maxDays: 400 });

    return NextResponse.json({
      simulation,
      simulated_at: new Date().toISOString(),
      scope: {
        execution_ids: scope.executionIds,
        execution_count: scope.executionIds.length,
        workspace_timezone: scope.workspaceTimezone,
        ...range,
      },
    });
  } catch (error) {
    if (error instanceof AnalyticsAdminInputError) {
      return analyticsAdminErrorResponse(error);
    }
    return taxonomyErrorResponse(error, "Falha ao simular reprocessamento.");
  }
}
