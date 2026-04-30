import { createHash } from "node:crypto";

import { dbAdmin } from "@/lib/firebase-admin";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { type ServerUserContext } from "@/lib/auth-server";
import {
  type LegacyTaskOriginType,
  type Task,
  type TaskHistoryItem,
  type TaskOrigin,
  type TaskProject,
  type TaskStatusDoc,
} from "@/types";
import { type FormTaskTrigger } from "@/types/forms";

type FirestoreRecord = Record<string, unknown>;

const DEFAULT_PROJECT_SLUG = "general";
const DEFAULT_PROJECT_NAME = "Tarefas gerais";

const DEFAULT_STATUSES: Array<
  Omit<TaskStatusDoc, "id" | "project_id"> & { id: string }
> = [
  {
    id: "pending",
    name: "Pendente",
    slug: "pending",
    category: "not_started",
    is_initial: true,
    is_terminal: false,
    order: 10,
    color: "#f97316",
  },
  {
    id: "in_progress",
    name: "Em progresso",
    slug: "in_progress",
    category: "active",
    is_initial: false,
    is_terminal: false,
    order: 20,
    color: "#3b82f6",
  },
  {
    id: "awaiting_approval",
    name: "Aguardando aprovação",
    slug: "awaiting_approval",
    category: "active",
    is_initial: false,
    is_terminal: false,
    order: 30,
    color: "#8b5cf6",
  },
  {
    id: "completed",
    name: "Concluída",
    slug: "completed",
    category: "done",
    is_initial: false,
    is_terminal: true,
    order: 40,
    color: "#16a34a",
  },
];

function isRecord(value: unknown): value is FirestoreRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toIsoString(value: unknown, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value) && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return fallback;
}

function normalizeOrigin(value: unknown): TaskOrigin {
  if (isRecord(value) && typeof value.kind === "string") {
    return value as TaskOrigin;
  }

  if (isRecord(value) && typeof value.type === "string") {
    return {
      kind: "legacy",
      type: value.type as LegacyTaskOriginType,
      id:
        typeof value.id === "string"
          ? value.id
          : typeof value.execution_id === "string"
            ? value.execution_id
            : "",
      ...(typeof value.questionId === "string" ? { questionId: value.questionId } : {}),
      ...(isRecord(value.details) ? { details: value.details } : {}),
    } as TaskOrigin;
  }

  return { kind: "manual" };
}

function normalizeHistory(value: unknown): TaskHistoryItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .map((item) => ({
      timestamp: toIsoString(item.timestamp),
      author: {
        id:
          isRecord(item.author) && typeof item.author.id === "string"
            ? item.author.id
            : "system",
        name:
          isRecord(item.author) && typeof item.author.name === "string"
            ? item.author.name
            : "Sistema",
      },
      action:
        typeof item.action === "string"
          ? (item.action as TaskHistoryItem["action"])
          : "commented",
      ...(typeof item.details === "string" ? { details: item.details } : {}),
    }));
}

function inferStatusFromDoc(data: FirestoreRecord) {
  if (typeof data.status === "string") {
    return data.status as Task["status"];
  }

  const slug = typeof data.status_slug === "string" ? data.status_slug : null;
  if (slug === "awaiting_approval") return "awaiting_approval";
  if (slug === "in_progress") return "in_progress";
  if (slug === "completed") return "completed";
  if (slug === "rejected") return "rejected";
  return "pending";
}

function adaptTaskDoc(id: string, data: FirestoreRecord): Task {
  return {
    id,
    ...(typeof data.project_id === "string" ? { projectId: data.project_id } : {}),
    ...(typeof data.status_id === "string" ? { statusId: data.status_id } : {}),
    title: typeof data.title === "string" ? data.title : "Tarefa sem título",
    ...(typeof data.description === "string" ? { description: data.description } : {}),
    status: inferStatusFromDoc(data),
    assigneeType:
      data.assigneeType === "profile" || data.assignee_type === "role"
        ? "profile"
        : "user",
    assigneeId:
      typeof data.assigneeId === "string"
        ? data.assigneeId
        : typeof data.assignee_id === "string"
          ? data.assignee_id
          : "",
    requiresApproval:
      data.requiresApproval === true || data.requires_approval === true,
    ...(data.approverType === "profile" || data.approver_type === "role"
      ? { approverType: "profile" as const }
      : typeof data.approverId === "string" || typeof data.approver_id === "string"
        ? { approverType: "user" as const }
        : {}),
    ...(typeof data.approverId === "string"
      ? { approverId: data.approverId }
      : typeof data.approver_id === "string"
        ? { approverId: data.approver_id }
        : {}),
    origin: normalizeOrigin(data.origin),
    history: normalizeHistory(data.history),
    createdAt: toIsoString(data.createdAt ?? data.created_at),
    updatedAt: toIsoString(data.updatedAt ?? data.updated_at),
    ...(typeof data.dueDate === "string"
      ? { dueDate: data.dueDate }
      : typeof data.due_date === "string"
        ? { dueDate: data.due_date }
        : {}),
    ...(typeof data.completedAt === "string"
      ? { completedAt: data.completedAt }
      : typeof data.completed_at === "string"
        ? { completedAt: data.completed_at }
        : {}),
  };
}

function makeStatusId(projectId: string, slug: string) {
  return `${projectId}__${slug}`;
}

function makeProjectId(workspaceId: string, slug: string) {
  return `${workspaceId}__${slug}`;
}

export function buildDeterministicTaskId(parts: string[]) {
  return createHash("sha256").update(parts.join("::")).digest("hex");
}

export async function ensureDefaultTaskProject(context: ServerUserContext) {
  const projectId = makeProjectId(context.workspace_id, DEFAULT_PROJECT_SLUG);
  const projectRef = dbAdmin.collection("task_projects").doc(projectId);

  await projectRef.set(
    {
      workspace_id: context.workspace_id,
      name: DEFAULT_PROJECT_NAME,
      description: "Projeto padrão do novo motor de tarefas.",
      members: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
    },
    { merge: true }
  );

  const batch = dbAdmin.batch();
  DEFAULT_STATUSES.forEach((status) => {
    const statusId = makeStatusId(projectId, status.slug);
    batch.set(
      dbAdmin.collection("task_statuses").doc(statusId),
      {
        project_id: projectId,
        name: status.name,
        slug: status.slug,
        category: status.category,
        is_initial: status.is_initial,
        is_terminal: status.is_terminal,
        order: status.order,
        color: status.color,
      },
      { merge: true }
    );
  });
  await batch.commit();

  return projectId;
}

export async function ensureTaskProjectStatuses(projectId: string) {
  const batch = dbAdmin.batch();
  DEFAULT_STATUSES.forEach((status) => {
    const statusId = makeStatusId(projectId, status.slug);
    batch.set(
      dbAdmin.collection("task_statuses").doc(statusId),
      {
        project_id: projectId,
        name: status.name,
        slug: status.slug,
        category: status.category,
        is_initial: status.is_initial,
        is_terminal: status.is_terminal,
        order: status.order,
        color: status.color,
      },
      { merge: true }
    );
  });
  await batch.commit();
}

export async function listTaskProjects(workspaceId: string) {
  const snap = await dbAdmin
    .collection("task_projects")
    .where("workspace_id", "==", workspaceId)
    .get();

  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<TaskProject, "id">) }));
}

export async function listTaskStatuses(projectIds: string[]) {
  if (projectIds.length === 0) return [] as TaskStatusDoc[];

  const chunks: string[][] = [];
  for (let index = 0; index < projectIds.length; index += 10) {
    chunks.push(projectIds.slice(index, index + 10));
  }

  const snapshots = await Promise.all(
    chunks.map((projectIdChunk) =>
      dbAdmin
        .collection("task_statuses")
        .where("project_id", "in", projectIdChunk)
        .get()
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs)
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<TaskStatusDoc, "id">) }))
    .sort((left, right) => left.order - right.order);
}

export async function listTasks(workspaceId: string) {
  const snap = await dbAdmin.collection("tasks").get();
  return snap.docs
    .filter((doc) => {
      const data = doc.data();
      const taskWorkspaceId = typeof data.workspace_id === "string" ? data.workspace_id : null;
      return taskWorkspaceId === null || taskWorkspaceId === workspaceId;
    })
    .map((doc) => adaptTaskDoc(doc.id, doc.data()))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildHistoryItem(
  context: ServerUserContext,
  action: TaskHistoryItem["action"],
  details?: string
): TaskHistoryItem {
  return {
    timestamp: new Date().toISOString(),
    author: {
      id: context.userDoc.id,
      name: context.userDoc.username,
    },
    action,
    ...(details ? { details } : {}),
  };
}

async function syncFormExecutionTaskStatus(params: {
  taskId: string;
  origin: Extract<TaskOrigin, { kind: "form_trigger" }>;
  status: Task["status"];
  actor: { user_id: string; username: string };
}) {
  const executionRef = checklistDbAdmin
    .collection("form_executions")
    .doc(params.origin.execution_id);

  const now = new Date();
  const nowIso = now.toISOString();

  await checklistDbAdmin.runTransaction(async (tx) => {
    const executionSnap = await tx.get(executionRef);
    if (!executionSnap.exists) {
      return;
    }

    const data = (executionSnap.data() ?? {}) as FirestoreRecord;
    if (!Array.isArray(data.items)) {
      return;
    }

    let changed = false;
    const nextItems = (data.items as FirestoreRecord[]).map((item) => {
      const matchesTask =
        item.linked_project_task_id === params.taskId ||
        (item.template_item_id === params.origin.template_item_id &&
          (item.template_section_id === params.origin.template_section_id ||
            item.section_id === params.origin.template_section_id));

      if (!matchesTask) return item;
      changed = true;
      return {
        ...item,
        linked_project_task_id: params.taskId,
        linked_project_task_status: params.status,
      };
    });

    if (!changed) {
      return;
    }

    tx.set(
      executionRef,
      {
        items: nextItems,
        updated_at: now,
      },
      { merge: true }
    );
    tx.set(executionRef.collection("events").doc(), {
      type: "task_status_changed",
      user_id: params.actor.user_id,
      username: params.actor.username,
      timestamp: now,
      metadata: {
        task_id: params.taskId,
        status: params.status,
        template_item_id: params.origin.template_item_id,
        template_section_id: params.origin.template_section_id,
        execution_id: params.origin.execution_id,
        synced_at: nowIso,
      },
    });
  });
}

async function resolveStatusDoc(projectId: string, status: Task["status"]) {
  const slug = status === "reopened" || status === "rejected" ? "pending" : status;
  const statusId = makeStatusId(projectId, slug);
  const snap = await dbAdmin.collection("task_statuses").doc(statusId).get();
  if (!snap.exists) {
    throw new Error("Status da tarefa não encontrado.");
  }

  return { id: snap.id, ...(snap.data() as Omit<TaskStatusDoc, "id">) };
}

async function resolveInitialStatusDoc(projectId: string) {
  const snap = await dbAdmin
    .collection("task_statuses")
    .where("project_id", "==", projectId)
    .where("is_initial", "==", true)
    .limit(1)
    .get();

  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<TaskStatusDoc, "id">) };
  }

  return resolveStatusDoc(projectId, "pending");
}

export async function createManualTask(params: {
  context: ServerUserContext;
  input: {
    title: string;
    description?: string;
    assigneeType?: "user" | "profile";
    assigneeId?: string;
    requiresApproval?: boolean;
    approverType?: "user" | "profile";
    approverId?: string;
    dueDate?: string;
    projectId?: string;
    origin?: Extract<TaskOrigin, { kind: "manual" | "legacy" }>;
  };
}) {
  const projectId =
    typeof params.input.projectId === "string" && params.input.projectId.trim()
      ? params.input.projectId.trim()
      : await ensureDefaultTaskProject(params.context);
  await ensureTaskProjectStatuses(projectId);
  const status = await resolveInitialStatusDoc(projectId);
  const now = new Date().toISOString();
  const history = [buildHistoryItem(params.context, "created", "Tarefa criada manualmente.")];

  const taskRef = dbAdmin.collection("tasks").doc();
  const payload = {
    workspace_id: params.context.workspace_id,
    project_id: projectId,
    status_id: status.id,
    status_slug: status.slug,
    title: params.input.title,
    description: params.input.description ?? "",
    assignee_type: params.input.assigneeType === "profile" ? "role" : "user",
    assignee_id: params.input.assigneeId ?? params.context.userDoc.id,
    requires_approval: params.input.requiresApproval === true,
    ...(params.input.approverId
      ? {
          approver_type:
            params.input.approverType === "profile" ? "role" : "user",
          approver_id: params.input.approverId,
        }
      : {}),
    origin: params.input.origin ?? { kind: "manual" },
    history,
    created_at: now,
    updated_at: now,
    ...(params.input.dueDate ? { due_date: params.input.dueDate } : {}),
    // Bridge fields while the UI still consumes the legacy Task shape.
    status: "pending",
    projectId,
    statusId: status.id,
    assigneeType: params.input.assigneeType ?? "user",
    assigneeId: params.input.assigneeId ?? params.context.userDoc.id,
    requiresApproval: params.input.requiresApproval === true,
    ...(params.input.approverType ? { approverType: params.input.approverType } : {}),
    ...(params.input.approverId ? { approverId: params.input.approverId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await taskRef.set(payload);
  return adaptTaskDoc(taskRef.id, payload);
}

export async function ensureTaskFromOrigin(params: {
  workspaceId: string;
  actor: { user_id: string; username: string };
  trigger: FormTaskTrigger;
  origin: Extract<TaskOrigin, { kind: "form_trigger" | "purchase_receipt" }>;
  title: string;
  description?: string;
  dueDate?: string;
}) {
  const taskId = buildDeterministicTaskId([
    params.workspaceId,
    params.origin.kind,
    ...(params.origin.kind === "form_trigger"
      ? [
          params.origin.execution_id,
          params.origin.template_section_id,
          params.origin.template_item_id,
        ]
      : [params.origin.receipt_id, params.origin.purchase_order_id]),
    params.trigger.id,
  ]);
  const taskRef = dbAdmin.collection("tasks").doc(taskId);
  const projectId = params.trigger.task_project_id;
  await ensureTaskProjectStatuses(projectId);

  try {
    await dbAdmin.runTransaction(async (tx) => {
      const taskSnap = await tx.get(taskRef);
      if (taskSnap.exists) {
        throw new Error("already-exists");
      }

      const pendingStatus = await resolveStatusDoc(projectId, "pending");
      const now = new Date().toISOString();
      const payload = {
        workspace_id: params.workspaceId,
        project_id: projectId,
        status_id: pendingStatus.id,
        status_slug: pendingStatus.slug,
        title: params.title,
        description: params.description ?? "",
        assignee_type: params.trigger.assignee_type === "role" ? "role" : "user",
        assignee_id: params.trigger.assignee_id,
        assignee_name: params.trigger.assignee_name ?? null,
        requires_approval: params.trigger.requires_approval,
        approver_id: params.trigger.approver_id ?? null,
        approver_name: params.trigger.approver_name ?? null,
        origin: params.origin,
        dedupe_key: taskId,
        section_id:
          params.origin.kind === "form_trigger"
            ? params.origin.template_section_id
            : null,
        created_at: now,
        updated_at: now,
        ...(params.dueDate ? { due_date: params.dueDate } : {}),
        history: [
          {
            timestamp: now,
            author: {
              id: params.actor.user_id,
              name: params.actor.username,
            },
            action: "created",
            details: "Tarefa criada automaticamente a partir da origem vinculada.",
          },
        ],
        // Bridge fields for current UI.
        status: "pending",
        projectId,
        statusId: pendingStatus.id,
        assigneeType: params.trigger.assignee_type === "role" ? "profile" : "user",
        assigneeId: params.trigger.assignee_id,
        requiresApproval: params.trigger.requires_approval,
        ...(params.trigger.approver_id ? { approverId: params.trigger.approver_id } : {}),
        ...(params.trigger.requires_approval
          ? {
              approverType: "user",
            }
          : {}),
        createdAt: now,
        updatedAt: now,
        ...(params.dueDate ? { dueDate: params.dueDate } : {}),
      };

      tx.create(taskRef, payload);
    });

    const createdSnap = await taskRef.get();
    return {
      created: true,
      task: adaptTaskDoc(taskId, (createdSnap.data() ?? {}) as FirestoreRecord),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (
      message === "already-exists" ||
      message.includes("already exists") ||
      message.includes("ALREADY_EXISTS")
    ) {
      const existingSnap = await taskRef.get();
      return {
        created: false,
        task: adaptTaskDoc(taskId, (existingSnap.data() ?? {}) as FirestoreRecord),
      };
    }

    throw error;
  }
}

export async function updateTaskDocument(params: {
  context: ServerUserContext;
  taskId: string;
  updates: Partial<Task>;
  allowOriginStatusChange?: boolean;
}) {
  const taskRef = dbAdmin.collection("tasks").doc(params.taskId);
  const snap = await taskRef.get();
  if (!snap.exists) {
    throw new Error("Tarefa não encontrada.");
  }

  const data = snap.data() as FirestoreRecord;
  const origin = normalizeOrigin(data.origin);
  if (
    params.updates.status &&
    origin.kind !== "manual" &&
    origin.kind !== "legacy" &&
    params.allowOriginStatusChange !== true
  ) {
    throw new Error("Tarefas não manuais devem ser atualizadas pela origem.");
  }

  const nextData: FirestoreRecord = {
    updated_at: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (typeof params.updates.title === "string") nextData.title = params.updates.title;
  if (typeof params.updates.description === "string") nextData.description = params.updates.description;
  if (typeof params.updates.status === "string") {
    const projectId =
      typeof data.project_id === "string"
        ? data.project_id
        : await ensureDefaultTaskProject(params.context);
    const statusDoc = await resolveStatusDoc(projectId, params.updates.status);
    nextData.status_id = statusDoc.id;
    nextData.status_slug = statusDoc.slug;
    nextData.status = params.updates.status === "reopened" ? "pending" : params.updates.status;
    nextData.statusId = statusDoc.id;
    if (params.updates.status === "completed" && !params.updates.completedAt) {
      nextData.completed_at = new Date().toISOString();
      nextData.completedAt = nextData.completed_at;
    }
    if (params.updates.status === "pending" || params.updates.status === "reopened") {
      nextData.completed_at = null;
      nextData.completedAt = null;
    }
  }
  if (typeof params.updates.assigneeType === "string") {
    nextData.assigneeType = params.updates.assigneeType;
    nextData.assignee_type =
      params.updates.assigneeType === "profile" ? "role" : "user";
  }
  if (typeof params.updates.assigneeId === "string") {
    nextData.assigneeId = params.updates.assigneeId;
    nextData.assignee_id = params.updates.assigneeId;
  }
  if (typeof params.updates.requiresApproval === "boolean") {
    nextData.requiresApproval = params.updates.requiresApproval;
    nextData.requires_approval = params.updates.requiresApproval;
  }
  if (typeof params.updates.approverType === "string") {
    nextData.approverType = params.updates.approverType;
    nextData.approver_type =
      params.updates.approverType === "profile" ? "role" : "user";
  }
  if (typeof params.updates.approverId === "string") {
    nextData.approverId = params.updates.approverId;
    nextData.approver_id = params.updates.approverId;
  }
  if (typeof params.updates.dueDate === "string") {
    nextData.dueDate = params.updates.dueDate;
    nextData.due_date = params.updates.dueDate;
  }
  if (Array.isArray(params.updates.history)) {
    nextData.history = params.updates.history;
  }
  if (typeof params.updates.completedAt === "string") {
    nextData.completedAt = params.updates.completedAt;
    nextData.completed_at = params.updates.completedAt;
  }

  await taskRef.set(nextData, { merge: true });
  const updatedTask = adaptTaskDoc(params.taskId, { ...data, ...nextData });
  if (origin.kind === "form_trigger" && typeof params.updates.status === "string") {
    await syncFormExecutionTaskStatus({
      taskId: params.taskId,
      origin,
      status: updatedTask.status,
      actor: {
        user_id: params.context.userDoc.id,
        username: params.context.userDoc.username,
      },
    });
  }

  return updatedTask;
}

export async function updateTaskStatus(params: {
  context: ServerUserContext;
  taskId: string;
  status: Task["status"];
  details?: string;
  allowOriginStatusChange?: boolean;
}) {
  const taskRef = dbAdmin.collection("tasks").doc(params.taskId);
  const snap = await taskRef.get();
  if (!snap.exists) {
    throw new Error("Tarefa não encontrada.");
  }

  const data = snap.data() as FirestoreRecord;
  const origin = normalizeOrigin(data.origin);
  if (
    origin.kind !== "manual" &&
    origin.kind !== "legacy" &&
    params.allowOriginStatusChange !== true
  ) {
    const error = new Error("Tarefas não manuais devem ser atualizadas pela origem.");
    (error as Error & { code?: number }).code = 409;
    throw error;
  }

  const currentTask = adaptTaskDoc(params.taskId, data);
  const projectId =
    typeof data.project_id === "string"
      ? data.project_id
      : await ensureDefaultTaskProject(params.context);
  const statusDoc = await resolveStatusDoc(projectId, params.status);

  let action: TaskHistoryItem["action"] = "status_changed";
  if (params.status === "completed") action = "completed";
  if (params.status === "awaiting_approval") action = "approved";
  if (params.status === "reopened" || params.status === "pending") action = "reopened";

  const now = new Date().toISOString();
  const history = [
    ...currentTask.history,
    buildHistoryItem(params.context, action, params.details),
  ];

  const nextStatus = params.status === "reopened" ? "pending" : params.status;
  const payload: FirestoreRecord = {
    status_id: statusDoc.id,
    status_slug: statusDoc.slug,
    status: nextStatus,
    history,
    updated_at: now,
    updatedAt: now,
    completed_at: nextStatus === "completed" ? now : null,
    completedAt: nextStatus === "completed" ? now : null,
  };

  await taskRef.set(payload, { merge: true });
  const updatedTask = adaptTaskDoc(params.taskId, { ...data, ...payload });
  if (origin.kind === "form_trigger") {
    await syncFormExecutionTaskStatus({
      taskId: params.taskId,
      origin,
      status: updatedTask.status,
      actor: {
        user_id: params.context.userDoc.id,
        username: params.context.userDoc.username,
      },
    });
  }

  return updatedTask;
}

export function isDefaultTaskProjectId(workspaceId: string, projectId: string) {
  return projectId === makeProjectId(workspaceId, DEFAULT_PROJECT_SLUG);
}

export async function deleteTaskDocument(taskId: string) {
  await dbAdmin.collection("tasks").doc(taskId).delete();
}
