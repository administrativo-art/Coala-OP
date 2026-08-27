import { type NextRequest, NextResponse } from "next/server";

import {
  AnalyticsAdminInputError,
  analyticsAdminErrorResponse,
  parseLocalDateRange,
} from "@/features/forms/analytics/admin-operations";
import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import { recomputeDailyMetricsRange } from "@/features/forms/analytics/daily-aggregates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "reprocess_occurrences");
    const body = (await request.json().catch(() => ({}))) as {
      from?: string;
      to?: string;
    };
    const range = parseLocalDateRange(body, { defaultDays: 2, maxDays: 400 });
    const report = await recomputeDailyMetricsRange(
      context.db,
      context.workspaceId,
      range.fromLocalDate,
      range.toLocalDate
    );

    return NextResponse.json({ ...report, ...range });
  } catch (error) {
    if (error instanceof AnalyticsAdminInputError) {
      return analyticsAdminErrorResponse(error);
    }
    return taxonomyErrorResponse(error, "Falha ao recomputar agregados.");
  }
}
