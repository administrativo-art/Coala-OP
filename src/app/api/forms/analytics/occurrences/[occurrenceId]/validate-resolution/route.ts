import { type NextRequest, NextResponse } from "next/server";

import {
  occurrenceActionErrorResponse,
  requireAnalyticsContext,
} from "@/features/forms/analytics/api";
import { validateOccurrenceResolution } from "@/features/forms/analytics/task-integration";
import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  contextArg: { params: Promise<{ occurrenceId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(
      request,
      "validate_occurrence_resolution"
    );
    const { occurrenceId } = await contextArg.params;

    await validateOccurrenceResolution(
      { db: context.db, taskDb: dbAdmin, tasksCollection: "tasks" },
      { occurrenceId, approvedBy: context.userId }
    );

    await logAction({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      username: context.username,
      module: "forms",
      action: "analytics_occurrence_resolution_validated",
      metadata: { occurrence_id: occurrenceId },
    });

    return NextResponse.json({ ok: true, resolution_status: "resolved" });
  } catch (error) {
    return occurrenceActionErrorResponse(error, "Falha ao validar resolução.");
  }
}
