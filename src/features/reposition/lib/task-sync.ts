import { type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  createManualTask,
  ensureTaskProject,
  ensureTaskSubproject,
  updateTaskDocument,
} from "@/features/tasks/lib/server";
import { type RepositionActivity, type Task } from "@/types";

const STOCK_TASK_PROJECT_SLUG = "stock";
const REPOSITION_TASK_SUBPROJECT_SLUG = "reposition";
const REPOSITION_TASK_ORIGIN_LINK = "/dashboard/stock/reposition";

function unique(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function buildDescription(activity: RepositionActivity) {
  const totalItems = activity.items?.length ?? 0;
  const itemSummary = (activity.items ?? [])
    .slice(0, 8)
    .map((item) => {
      const moved = Number(item.quantityNeeded ?? 0);
      return `- ${item.productName}: ${moved}`;
    })
    .join("\n");

  return [
    `Origem: ${activity.kioskOriginName}`,
    `Destino: ${activity.kioskDestinationName}`,
    `Status operacional: ${activity.status}`,
    `${totalItems} ${totalItems === 1 ? "item" : "itens"} na reposição.`,
    itemSummary ? `\nItens:\n${itemSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function mapTaskStatus(activity: RepositionActivity): Task["status"] {
  if (activity.status === "Concluído") return "completed";
  if (activity.status === "Cancelada") return "rejected";
  if (
    activity.status === "Recebido com divergência" ||
    activity.status === "Recebido sem divergência"
  ) {
    return "in_progress";
  }
  return "pending";
}

function buildTaskPatch(activity: RepositionActivity, projectId: string, subprojectId: string): Partial<Task> {
  const watcherUserIds = unique([
    activity.requestedBy?.userId,
    activity.updatedBy?.userId,
  ]);

  if (activity.status === "Aguardando recebimento") {
    return {
      projectId,
      subprojectId,
      subprojectName: "Reposição",
      title: `Receber reposição: ${activity.kioskOriginName} → ${activity.kioskDestinationName}`,
      description: buildDescription(activity),
      status: "pending",
      assigneeType: "unit",
      assigneeId: activity.kioskDestinationId,
      unitId: activity.kioskDestinationId,
      unitName: activity.kioskDestinationName,
      priority: "normal",
      watcherUserIds,
      visibilityScope: "unit",
      originLink: REPOSITION_TASK_ORIGIN_LINK,
    };
  }

  if (
    activity.status === "Recebido com divergência" ||
    activity.status === "Recebido sem divergência"
  ) {
    const hasDivergence = activity.status === "Recebido com divergência";
    return {
      projectId,
      subprojectId,
      subprojectName: "Reposição",
      title: hasDivergence
        ? `Analisar divergência de reposição: ${activity.kioskDestinationName}`
        : `Efetivar reposição: ${activity.kioskDestinationName}`,
      description: buildDescription(activity),
      status: "in_progress",
      assigneeType: "user",
      assigneeId: activity.requestedBy.userId,
      unitId: activity.kioskDestinationId,
      unitName: activity.kioskDestinationName,
      priority: hasDivergence ? "high" : "normal",
      watcherUserIds,
      visibilityScope: "unit",
      originLink: REPOSITION_TASK_ORIGIN_LINK,
    };
  }

  if (activity.status === "Concluído") {
    return {
      projectId,
      subprojectId,
      subprojectName: "Reposição",
      title: `Reposição concluída: ${activity.kioskOriginName} → ${activity.kioskDestinationName}`,
      description: buildDescription(activity),
      status: "completed",
      assigneeType: "user",
      assigneeId: activity.updatedBy?.userId || activity.requestedBy.userId,
      unitId: activity.kioskDestinationId,
      unitName: activity.kioskDestinationName,
      watcherUserIds,
      visibilityScope: "unit",
      originLink: REPOSITION_TASK_ORIGIN_LINK,
    };
  }

  if (activity.status === "Cancelada") {
    return {
      projectId,
      subprojectId,
      subprojectName: "Reposição",
      title: `Reposição cancelada: ${activity.kioskOriginName} → ${activity.kioskDestinationName}`,
      description: buildDescription(activity),
      status: "rejected",
      assigneeType: "user",
      assigneeId: activity.updatedBy?.userId || activity.requestedBy.userId,
      unitId: activity.kioskDestinationId,
      unitName: activity.kioskDestinationName,
      watcherUserIds,
      visibilityScope: "unit",
      originLink: REPOSITION_TASK_ORIGIN_LINK,
    };
  }

  return {
    projectId,
    subprojectId,
    subprojectName: "Reposição",
    title: `Despachar reposição: ${activity.kioskOriginName} → ${activity.kioskDestinationName}`,
    description: buildDescription(activity),
    status: mapTaskStatus(activity),
    assigneeType: "user",
    assigneeId: activity.requestedBy.userId,
    unitId: activity.kioskOriginId,
    unitName: activity.kioskOriginName,
    priority: "normal",
    watcherUserIds,
    visibilityScope: "unit",
    originLink: REPOSITION_TASK_ORIGIN_LINK,
  };
}

async function findExistingRepositionTaskId(activityId: string) {
  const snap = await dbAdmin
    .collection("tasks")
    .where("origin.id", "==", activityId)
    .get();

  const match = snap.docs.find((doc) => {
    const origin = doc.data().origin as Record<string, unknown> | undefined;
    return origin?.kind === "legacy" && origin?.type === "reposition_activity";
  });
  return match?.id ?? null;
}

export async function syncRepositionTask(params: {
  context: ServerUserContext;
  activity: RepositionActivity;
}) {
  const projectId = await ensureTaskProject(params.context, {
    slug: STOCK_TASK_PROJECT_SLUG,
    name: "Gestão de Estoque",
    description: "Projeto macro das tarefas operacionais de estoque.",
  });
  const subprojectId = await ensureTaskSubproject(params.context, {
    projectId,
    slug: REPOSITION_TASK_SUBPROJECT_SLUG,
    name: "Reposição",
    description: "Quadro de tarefas geradas pelo fluxo de reposição de estoque.",
  });
  const patch = buildTaskPatch(params.activity, projectId, subprojectId);
  const taskId =
    params.activity.taskId ?? (await findExistingRepositionTaskId(params.activity.id));

  if (taskId) {
    const task = await updateTaskDocument({
      context: params.context,
      taskId,
      allowOriginStatusChange: true,
      updates: patch,
    });
    if (params.activity.taskId !== task.id) {
      await dbAdmin
        .collection("repositionActivities")
        .doc(params.activity.id)
        .set({ taskId: task.id }, { merge: true });
    }
    return task;
  }

  const task = await createManualTask({
    context: params.context,
    input: {
      title: patch.title || `Reposição ${params.activity.kioskOriginName} → ${params.activity.kioskDestinationName}`,
      description: patch.description,
      assigneeType: patch.assigneeType,
      assigneeId: patch.assigneeId,
      projectId,
      subprojectId,
      subprojectName: "Reposição",
      unitId: patch.unitId,
      unitName: patch.unitName,
      priority: patch.priority,
      watcherUserIds: patch.watcherUserIds,
      visibilityScope: patch.visibilityScope,
      originLink: patch.originLink,
      origin: {
        kind: "legacy",
        type: "reposition_activity",
        id: params.activity.id,
        details: {
          kiosk_origin_id: params.activity.kioskOriginId,
          kiosk_origin_name: params.activity.kioskOriginName,
          kiosk_destination_id: params.activity.kioskDestinationId,
          kiosk_destination_name: params.activity.kioskDestinationName,
          status: params.activity.status,
        },
      },
    },
  });

  if (patch.status && patch.status !== task.status) {
    await updateTaskDocument({
      context: params.context,
      taskId: task.id,
      allowOriginStatusChange: true,
      updates: patch,
    });
  }

  await dbAdmin
    .collection("repositionActivities")
    .doc(params.activity.id)
    .set({ taskId: task.id }, { merge: true });

  return task;
}

export async function syncRepositionTaskSafely(params: {
  context: ServerUserContext;
  activity: RepositionActivity;
  label: string;
}) {
  try {
    return await syncRepositionTask(params);
  } catch (error) {
    console.error(`[REPOSITION TASK] Falha ao sincronizar tarefa: ${params.label}`, {
      activityId: params.activity.id,
      taskId: params.activity.taskId,
      error,
    });
    return null;
  }
}
