import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { occurrenceActionErrorResponse } from "@/features/forms/analytics/api";
import { rejectOccurrenceResolution } from "@/features/forms/analytics/task-integration";
import { ANALYTICS_COLLECTIONS } from "@/features/forms/analytics/types";
import { assertFormAnalyticsPermission } from "@/features/forms/lib/server-access";
import { createManualTask, getTaskById } from "@/features/tasks/lib/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  rejection_reason: z.string().trim().min(1).max(2000),
  next_action: z
    .enum([
      "create_follow_up_task",
      "return_to_responsible",
      "keep_open_without_task",
    ])
    .default("create_follow_up_task"),
});

export async function POST(
  request: NextRequest,
  contextArg: { params: Promise<{ occurrenceId: string }> }
) {
  try {
    const user = await requireUser(request);
    assertFormAnalyticsPermission(
      user.permissions,
      user.isDefaultAdmin,
      "validate_occurrence_resolution"
    );
    const { occurrenceId } = await contextArg.params;
    const body = bodySchema.parse(await request.json());

    const result = await rejectOccurrenceResolution(
      {
        db: checklistDbAdmin,
        taskDb: dbAdmin,
        tasksCollection: "tasks",
        createFollowUpTask: async (params) => {
          const occurrenceSnap = await checklistDbAdmin
            .collection(ANALYTICS_COLLECTIONS.occurrences)
            .doc(params.occurrence_id)
            .get();
          const lastTaskId = String(
            occurrenceSnap.get("last_task_id") ??
              occurrenceSnap.get("current_primary_task_id") ??
              ""
          );
          const lastTask = lastTaskId ? await getTaskById(lastTaskId) : null;
          const resultName = String(
            occurrenceSnap.get("result_name_snapshot") ?? "Ocorrência"
          );
          const targetName = String(
            occurrenceSnap.get("target_name_snapshot") ?? ""
          );
          const executionId = String(occurrenceSnap.get("execution_id") ?? "");
          const unitId = occurrenceSnap.get("unit_id");
          const unitName = occurrenceSnap.get("unit_name_snapshot");

          const task = await createManualTask({
            context: user,
            input: {
              title: lastTask
                ? `Reaberta: ${lastTask.title}`
                : `Tratar ocorrência: ${resultName} — ${targetName}`,
              description: `Resolução rejeitada na validação.\nMotivo: ${params.reason}`,
              ...(lastTask?.projectId ? { projectId: lastTask.projectId } : {}),
              ...(lastTask?.assigneeType
                ? { assigneeType: lastTask.assigneeType }
                : {}),
              ...(lastTask?.assigneeId
                ? { assigneeId: lastTask.assigneeId }
                : {}),
              ...(typeof unitId === "string" && unitId
                ? { unitId, ...(typeof unitName === "string" && unitName ? { unitName } : {}) }
                : {}),
              ...(executionId
                ? { originLink: `/dashboard/forms/${executionId}/view` }
                : {}),
            },
          });

          return { id: task.id };
        },
      },
      {
        occurrenceId,
        rejectedBy: user.userDoc.id,
        rejectionReason: body.rejection_reason,
        nextAction: body.next_action,
      }
    );

    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "analytics_occurrence_resolution_rejected",
      metadata: {
        occurrence_id: occurrenceId,
        next_action: body.next_action,
        follow_up_task_id: result.followUpTaskId ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      resolution_status: "open",
      follow_up_task_id: result.followUpTaskId ?? null,
    });
  } catch (error) {
    return occurrenceActionErrorResponse(error, "Falha ao rejeitar resolução.");
  }
}
