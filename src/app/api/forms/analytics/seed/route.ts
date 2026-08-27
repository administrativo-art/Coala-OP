import { type NextRequest, NextResponse } from "next/server";

import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import { seedAnalyticsTaxonomy } from "@/features/forms/analytics/seed";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const report = await seedAnalyticsTaxonomy(context.db, {
      workspaceId: context.workspaceId,
      createdBy: context.userId,
    });

    await logAction({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      username: context.username,
      module: "forms",
      action: "analytics_taxonomy_seeded",
      metadata: { report },
    });

    return NextResponse.json({ report });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao executar seed de analytics.");
  }
}
