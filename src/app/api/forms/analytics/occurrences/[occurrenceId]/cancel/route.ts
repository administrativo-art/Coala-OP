import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  occurrenceActionErrorResponse,
  requireAnalyticsContext,
} from "@/features/forms/analytics/api";
import { cancelOccurrenceManually } from "@/features/forms/analytics/task-integration";
import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ reason: z.string().trim().max(2000).optional() })
  .optional();

export async function POST(
  request: NextRequest,
  contextArg: { params: Promise<{ occurrenceId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(
      request,
      "resolve_occurrences"
    );
    const { occurrenceId } = await contextArg.params;
    const body = bodySchema.parse(await request.json().catch(() => undefined));

    await cancelOccurrenceManually(
      { db: context.db, taskDb: dbAdmin, tasksCollection: "tasks" },
      {
        occurrenceId,
        cancelledBy: context.userId,
        reason: body?.reason,
      }
    );

    await logAction({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      username: context.username,
      module: "forms",
      action: "analytics_occurrence_cancelled_manually",
      metadata: { occurrence_id: occurrenceId },
    });

    return NextResponse.json({ ok: true, resolution_status: "cancelled" });
  } catch (error) {
    return occurrenceActionErrorResponse(error, "Falha ao cancelar ocorrência.");
  }
}
