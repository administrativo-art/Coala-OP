import { NextResponse } from "next/server";

import {
  AnalyticsAdminInputError,
  analyticsAdminErrorResponse,
  assertCronSecret,
  parsePositiveInt,
  parseWorkspaceIds,
} from "@/features/forms/analytics/admin-operations";
import { recomputeDailyMetricsRange } from "@/features/forms/analytics/daily-aggregates";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertCronSecret(request);
    const url = new URL(request.url);
    const workspaceIds = parseWorkspaceIds(url.searchParams.get("workspace_id"));
    if (workspaceIds.length === 0) {
      throw new AnalyticsAdminInputError(
        "Informe workspace_id ou FORMS_ANALYTICS_JOB_WORKSPACE_IDS."
      );
    }

    const days = parsePositiveInt(url.searchParams.get("days"), 2, 14);
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    const fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const from = fromDate.toISOString().slice(0, 10);

    const results = [];
    for (const workspaceId of workspaceIds) {
      const report = await recomputeDailyMetricsRange(
        checklistDbAdmin,
        workspaceId,
        from,
        to
      );
      results.push({ workspace_id: workspaceId, ...report });
    }

    return NextResponse.json({ from, to, results });
  } catch (error) {
    if (error instanceof AnalyticsAdminInputError) {
      return analyticsAdminErrorResponse(error);
    }
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no job." },
      { status }
    );
  }
}
