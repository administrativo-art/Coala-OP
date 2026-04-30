import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertLegacyChecklistWriteAllowed } from "@/features/dp-checklists/lib/rollout";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  normalizeOperationalTaskForApi,
} from "@/features/dp-checklists/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checklistTaskUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
  resolutionNotes: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    await assertLegacyChecklistWriteAllowed();
    const access = await assertDPChecklistAccess(request, "operate");
    const actor = await loadChecklistActor(access.decoded.uid);
    const { taskId } = await context.params;

    if (!taskId) {
      return NextResponse.json({ error: "Tarefa inválida." }, { status: 400 });
    }

    const parsed = checklistTaskUpdateSchema.parse(await request.json());
    const taskRef = checklistDbAdmin.collection("operationalTasks").doc(taskId);
    const taskSnap = await taskRef.get();

    if (!taskSnap.exists) {
      return NextResponse.json(
        { error: "Tarefa operacional não encontrada." },
        { status: 404 }
      );
    }

    const currentData = taskSnap.data() ?? {};
    const now = new Date();
    const updatePayload: Record<string, unknown> = {
      status: parsed.status,
      updatedAt: now,
    };

    if (parsed.status === "in_progress") {
      updatePayload.assignedToUserId = actor.userId;
      updatePayload.assignedToUserName = actor.username;
    }

    if (parsed.status === "resolved" || parsed.status === "closed") {
      updatePayload.resolvedAt = now;
      updatePayload.resolvedBy = actor.username;
      updatePayload.resolutionNotes = parsed.resolutionNotes ?? null;
      updatePayload.assignedToUserId =
        currentData.assignedToUserId ?? actor.userId;
      updatePayload.assignedToUserName =
        currentData.assignedToUserName ?? actor.username;
    }

    if (parsed.status === "open") {
      updatePayload.resolvedAt = null;
      updatePayload.resolvedBy = null;
      updatePayload.resolutionNotes = null;
    }

    await taskRef.update(updatePayload);

    const updatedSnap = await taskRef.get();
    const task = normalizeOperationalTaskForApi(taskId, updatedSnap.data() ?? {});

    await appendChecklistAudit("task_status_updated", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      taskId,
      executionId: task.executionId,
      itemId: task.itemId,
      status: task.status,
    });

    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar a tarefa operacional.",
      },
      { status: 400 }
    );
  }
}
