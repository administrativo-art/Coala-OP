import { type NextRequest, NextResponse } from "next/server";

import {
  AnalyticsAdminInputError,
  analyticsAdminErrorResponse,
  normalizeRetentionDays,
} from "@/features/forms/analytics/admin-operations";
import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import { backfillAnonymizeAfter } from "@/features/forms/analytics/anonymization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_retention_policy");
    const body = (await request.json().catch(() => ({}))) as {
      retentionDays?: number;
      batchLimit?: number;
    };
    const retentionDays = normalizeRetentionDays(
      body.retentionDays ?? process.env.FORMS_ANALYTICS_PERSONAL_RETENTION_DAYS
    );
    const report = await backfillAnonymizeAfter(
      context.db,
      context.workspaceId,
      retentionDays,
      Math.min(Math.max(Number(body.batchLimit ?? 400), 1), 500)
    );

    return NextResponse.json({ ...report, retention_days: retentionDays });
  } catch (error) {
    if (error instanceof AnalyticsAdminInputError) {
      return analyticsAdminErrorResponse(error);
    }
    return taxonomyErrorResponse(error, "Falha ao executar backfill de retenção.");
  }
}
