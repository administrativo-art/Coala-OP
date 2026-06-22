import { type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  createManualTask,
  ensureTaskProject,
  ensureTaskSubproject,
  updateTaskDocument,
} from "@/features/tasks/lib/server";
import { type StockAuditSession, type Task } from "@/types";

export const STOCK_COUNT_APPROVER_ASSIGNEE_ID = "__stock_count_approver__";

const STOCK_TASK_PROJECT_SLUG = "stock";
const STOCK_COUNT_TASK_SUBPROJECT_SLUG = "stock-count";
const STOCK_COUNT_TASK_ORIGIN_LINK = "/dashboard/stock/count";

function unique(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function countDivergences(session: StockAuditSession) {
  return (session.items ?? []).filter((item) => {
    const directDivergence = Number(item.finalQuantity ?? 0) !== Number(item.systemQuantity ?? 0);
    return directDivergence || (item.divergences?.length ?? 0) > 0 || (item.adjustments?.length ?? 0) > 0;
  }).length;
}

function buildDescription(session: StockAuditSession) {
  const totalItems = session.items?.length ?? 0;
  const divergenceCount = countDivergences(session);
  const itemSummary = (session.items ?? [])
    .filter((item) => Number(item.finalQuantity ?? 0) !== Number(item.systemQuantity ?? 0))
    .slice(0, 10)
    .map((item) => `- ${item.productName}: sistema ${item.systemQuantity} → final ${item.finalQuantity} ${item.displayUnit}`)
    .join("\n");

  return [
    `Unidade: ${session.kioskName}`,
    `Responsável pela contagem: ${session.auditedBy?.username ?? "Não informado"}`,
    `Status operacional: ${session.status}`,
    `${totalItems} ${totalItems === 1 ? "item contado" : "itens contados"}.`,
    `${divergenceCount} ${divergenceCount === 1 ? "divergência encontrada" : "divergências encontradas"}.`,
    itemSummary ? `\nDivergências:\n${itemSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTaskPatch(session: StockAuditSession, projectId: string, subprojectId: string): Partial<Task> {
  const divergenceCount = countDivergences(session);
  const watcherUserIds = unique([session.auditedBy?.userId]);

  if (session.status === "completed") {
    return {
      projectId,
      subprojectId,
      subprojectName: "Contagem de estoque",
      title: `Contagem concluída: ${session.kioskName}`,
      description: buildDescription(session),
      status: "completed",
      assigneeType: "role",
      assigneeId: STOCK_COUNT_APPROVER_ASSIGNEE_ID,
      requiresApproval: true,
      approverType: "role",
      approverId: STOCK_COUNT_APPROVER_ASSIGNEE_ID,
      unitId: session.kioskId,
      unitName: session.kioskName,
      priority: divergenceCount > 0 ? "high" : "normal",
      watcherUserIds,
      visibilityScope: "unit",
      originLink: STOCK_COUNT_TASK_ORIGIN_LINK,
      createdByUserId: session.auditedBy?.userId,
      createdByUsername: session.auditedBy?.username,
    };
  }

  return {
    projectId,
    subprojectId,
    subprojectName: "Contagem de estoque",
    title: `Aprovar contagem: ${session.kioskName}`,
    description: buildDescription(session),
    status: "awaiting_approval",
    assigneeType: "role",
    assigneeId: STOCK_COUNT_APPROVER_ASSIGNEE_ID,
    requiresApproval: true,
    approverType: "role",
    approverId: STOCK_COUNT_APPROVER_ASSIGNEE_ID,
    unitId: session.kioskId,
    unitName: session.kioskName,
    priority: divergenceCount > 0 ? "high" : "normal",
    watcherUserIds,
    visibilityScope: "unit",
    originLink: STOCK_COUNT_TASK_ORIGIN_LINK,
    createdByUserId: session.auditedBy?.userId,
    createdByUsername: session.auditedBy?.username,
  };
}

async function findExistingStockCountTaskId(sessionId: string) {
  const snap = await dbAdmin
    .collection("tasks")
    .where("origin.id", "==", sessionId)
    .get();

  const match = snap.docs.find((doc) => {
    const origin = doc.data().origin as Record<string, unknown> | undefined;
    return origin?.kind === "legacy" && origin?.type === "stock_count_approval";
  });

  return match?.id ?? null;
}

export async function syncStockCountTask(params: {
  context: ServerUserContext;
  session: StockAuditSession;
}) {
  const projectId = await ensureTaskProject(params.context, {
    slug: STOCK_TASK_PROJECT_SLUG,
    name: "Gestão de Estoque",
    description: "Projeto macro das tarefas operacionais de estoque.",
  });
  const subprojectId = await ensureTaskSubproject(params.context, {
    projectId,
    slug: STOCK_COUNT_TASK_SUBPROJECT_SLUG,
    name: "Contagem de estoque",
    description: "Quadro de tarefas geradas por sessões de contagem de estoque.",
  });
  const patch = buildTaskPatch(params.session, projectId, subprojectId);
  const existingTaskId =
    params.session.taskId ?? (await findExistingStockCountTaskId(params.session.id));

  if (existingTaskId) {
    try {
      const task = await updateTaskDocument({
        context: params.context,
        taskId: existingTaskId,
        allowOriginStatusChange: true,
        updates: patch,
      });
      if (params.session.taskId !== task.id) {
        await dbAdmin
          .collection("stockAuditSessions")
          .doc(params.session.id)
          .set({ taskId: task.id }, { merge: true });
      }
      return task;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.toLowerCase().includes("não encontrada")) {
        throw error;
      }
    }
  }

  const task = await createManualTask({
    context: params.context,
    input: {
      title: patch.title || `Aprovar contagem: ${params.session.kioskName}`,
      description: patch.description,
      assigneeType: patch.assigneeType,
      assigneeId: patch.assigneeId,
      requiresApproval: patch.requiresApproval,
      approverType: patch.approverType,
      approverId: patch.approverId,
      projectId,
      subprojectId,
      subprojectName: "Contagem de estoque",
      unitId: patch.unitId,
      unitName: patch.unitName,
      priority: patch.priority,
      watcherUserIds: patch.watcherUserIds,
      visibilityScope: patch.visibilityScope,
      originLink: patch.originLink,
      origin: {
        kind: "legacy",
        type: "stock_count_approval",
        id: params.session.id,
        details: {
          kiosk_id: params.session.kioskId,
          kiosk_name: params.session.kioskName,
          status: params.session.status,
          divergence_count: countDivergences(params.session),
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
    .collection("stockAuditSessions")
    .doc(params.session.id)
    .set({ taskId: task.id }, { merge: true });

  return task;
}

export async function cancelStockCountTask(params: {
  context: ServerUserContext;
  sessionId: string;
  taskId?: string;
}) {
  const taskId = params.taskId ?? (await findExistingStockCountTaskId(params.sessionId));
  if (!taskId) return null;

  return updateTaskDocument({
    context: params.context,
    taskId,
    allowOriginStatusChange: true,
    updates: {
      status: "rejected",
      title: "Contagem cancelada",
      description: "A sessão de contagem foi cancelada/removida.",
      originLink: STOCK_COUNT_TASK_ORIGIN_LINK,
    },
  });
}

export async function syncStockCountTaskSafely(params: {
  context: ServerUserContext;
  session: StockAuditSession;
  label: string;
}) {
  try {
    return await syncStockCountTask(params);
  } catch (error) {
    console.error(`[STOCK COUNT TASK] Falha ao sincronizar tarefa: ${params.label}`, {
      sessionId: params.session.id,
      taskId: params.session.taskId,
      error,
    });
    return null;
  }
}

export async function cancelStockCountTaskSafely(params: {
  context: ServerUserContext;
  sessionId: string;
  taskId?: string;
  label: string;
}) {
  try {
    return await cancelStockCountTask(params);
  } catch (error) {
    console.error(`[STOCK COUNT TASK] Falha ao cancelar tarefa: ${params.label}`, {
      sessionId: params.sessionId,
      taskId: params.taskId,
      error,
    });
    return null;
  }
}
