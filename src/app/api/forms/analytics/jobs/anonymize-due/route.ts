import { NextResponse } from "next/server";

import {
  AnalyticsAdminInputError,
  analyticsAdminErrorResponse,
  assertCronSecret,
  parsePositiveInt,
  parseWorkspaceIds,
} from "@/features/forms/analytics/admin-operations";
import { anonymizeDueOccurrences } from "@/features/forms/analytics/anonymization-service";
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

    const batchLimit = parsePositiveInt(url.searchParams.get("batch_limit"), 200, 500);
    const keepOriginalInVault = url.searchParams.get("vault") !== "false";
    const results = [];

    for (const workspaceId of workspaceIds) {
      const report = await anonymizeDueOccurrences(checklistDbAdmin, workspaceId, {
        batchLimit,
        keepOriginalInVault,
      });
      results.push({ workspace_id: workspaceId, ...report });
    }

    return NextResponse.json({ results });
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
