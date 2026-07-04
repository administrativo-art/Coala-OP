import { type NextRequest, NextResponse } from "next/server";

import {
  AnalyticsAdminInputError,
  analyticsAdminErrorResponse,
} from "@/features/forms/analytics/admin-operations";
import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import { anonymizeDueOccurrences } from "@/features/forms/analytics/anonymization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_retention_policy");
    const body = (await request.json().catch(() => ({}))) as {
      batchLimit?: number;
      keepOriginalInVault?: boolean;
    };
    const report = await anonymizeDueOccurrences(context.db, context.workspaceId, {
      batchLimit: Math.min(Math.max(Number(body.batchLimit ?? 200), 1), 500),
      keepOriginalInVault: body.keepOriginalInVault !== false,
    });

    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof AnalyticsAdminInputError) {
      return analyticsAdminErrorResponse(error);
    }
    return taxonomyErrorResponse(error, "Falha ao anonimizar ocorrências vencidas.");
  }
}
