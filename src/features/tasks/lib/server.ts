import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { type ServerUserContext } from "@/lib/auth-server";
import {
  hasActiveOccurrenceLink,
  syncOccurrencesFromTask,
  type TaskIntegrationDeps,
} from "@/features/forms/analytics/task-integration";
import {
  isTaskCompletionResult,
  isTaskLifecycleState,
  resolveCompletionResult,
} from "@/features/forms/analytics/task-sync-core";
import type {
  TaskCompletionResult,
  TaskLifecycleState,
} from "@/features/forms/analytics/task-model";
import { canActOnTask, canViewTask } from "@/features/tasks/lib/server-access";
import { canAccessUnit } from "@/lib/unit-access";
import {
  type LegacyTaskOriginType,
  type Task,
  type TaskHistoryItem,
  type TaskOrigin,
  type TaskProject,
  type TaskSubproject,
  type TaskStatusDoc,
} from "@/types";
import { type FormTaskTrigger } from "@/types/forms";

type FirestoreRecord = Record<string, unknown>;

const DEFAULT_PROJECT_SLUG = "general";
const DEFAULT_PROJECT_NAME = "Tarefas gerais";
const DEFAULT_SUBPROJECT_SLUG = "geral";
const DEFAULT_SUBPROJECT_NAME = "Geral";
const TASK_OCCURRENCE_SYNC_DEPS: TaskIntegrationDeps = {
  db: checklistDbAdmin,
  taskDb: dbAdmin,
  tasksCollection: "tasks",
};

const DEFAULT_STATUSES: Array<
  Omit<TaskStatusDoc, "id" | "project_id" | "subproject_id"> & { id: string }
> = [
  {
    id: "pending",
    name: "Pendente",
    slug: "pending",
    category: "not_started",
    lifecycle_state: "open",
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
    lifecycle_state: "in_progress",
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
    lifecycle_state: "waiting",
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
    lifecycle_state: "completed",
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

function inferLifecycleFromTaskStatus(
  status: Task["status"],
  statusDoc?: Pick<TaskStatusDoc, "category" | "lifecycle_state" | "slug">
): TaskLifecycleState {
  if (isTaskLifecycleState(statusDoc?.lifecycle_state)) {
    return statusDoc.lifecycle_state;
  }

  if (status === "in_progress") return "in_progress";
  if (status === "awaiting_approval") return "waiting";
  if (status === "completed") return "completed";

  if (statusDoc?.category === "active") return "in_progress";
  if (statusDoc?.category === "done") return "completed";
  if (statusDoc?.category === "canceled") return "cancelled";

  return "open";
}

function inferLifecycleFromStatusDoc(
  statusDoc: Pick<TaskStatusDoc, "category" | "lifecycle_state" | "slug">
): TaskLifecycleState {
  if (isTaskLifecycleState(statusDoc.lifecycle_state)) {
    return statusDoc.lifecycle_state;
  }
  if (statusDoc.slug === "in_progress") return "in_progress";
  if (statusDoc.slug === "awaiting_approval") return "waiting";
  if (statusDoc.slug === "completed") return "completed";
  if (statusDoc.slug === "cancelled" || statusDoc.slug === "canceled") {
    return "cancelled";
  }
  if (statusDoc.category === "active") return "in_progress";
  if (statusDoc.category === "done") return "completed";
  if (statusDoc.category === "canceled") return "cancelled";
  return "open";
}

function normalizeCompletionResult(
  value: unknown
): TaskCompletionResult | undefined {
  return isTaskCompletionResult(value) ? value : undefined;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function assertTaskWorkspace(data: FirestoreRecord, context: ServerUserContext) {
  const workspaceId = typeof data.workspace_id === "string" ? data.workspace_id : null;
  if (workspaceId !== context.workspace_id) {
    const error = new Error("Tarefa não encontrada neste workspace.");
    (error as Error & { code?: number }).code = 404;
    throw error;
  }
}

function adaptTaskDoc(id: string, data: FirestoreRecord): Task {
  const createdBy = isRecord(data.created_by) ? data.created_by : null;
  return {
    id,
    ...(typeof data.workspace_id === "string" ? { workspaceId: data.workspace_id } : {}),
    ...(typeof data.project_id === "string" ? { projectId: data.project_id } : {}),
    ...(typeof data.subproject_id === "string"
      ? { subprojectId: data.subproject_id }
      : typeof data.subprojectId === "string"
        ? { subprojectId: data.subprojectId }
        : {}),
    ...(typeof data.subproject_name === "string"
      ? { subprojectName: data.subproject_name }
      : typeof data.subprojectName === "string"
        ? { subprojectName: data.subprojectName }
        : {}),
    ...(typeof data.status_id === "string" ? { statusId: data.status_id } : {}),
    title: typeof data.title === "string" ? data.title : "Tarefa sem título",
    ...(typeof data.description === "string" ? { description: data.description } : {}),
    status: inferStatusFromDoc(data),
    ...(isTaskLifecycleState(data.lifecycle_state)
      ? { lifecycleState: data.lifecycle_state }
      : {}),
    ...(isTaskCompletionResult(data.completion_result)
      ? { completionResult: data.completion_result }
      : {}),
    ...(typeof data.version === "number" ? { version: data.version } : {}),
    assigneeType:
      data.assigneeType === "profile" ||
      data.assigneeType === "role" ||
      data.assigneeType === "team" ||
      data.assigneeType === "unit"
        ? data.assigneeType
        : data.assignee_type === "role" ||
            data.assignee_type === "team" ||
            data.assignee_type === "unit"
          ? data.assignee_type
          : "user",
    assigneeId:
      typeof data.assigneeId === "string"
        ? data.assigneeId
        : typeof data.assignee_id === "string"
          ? data.assignee_id
          : "",
    requiresApproval:
      data.requiresApproval === true || data.requires_approval === true,
    ...(data.approverType === "profile" ||
    data.approverType === "role" ||
    data.approverType === "team" ||
    data.approverType === "unit"
      ? { approverType: data.approverType as Task["approverType"] }
      : data.approver_type === "role" ||
          data.approver_type === "team" ||
          data.approver_type === "unit"
        ? { approverType: data.approver_type as Task["approverType"] }
      : typeof data.approverId === "string" || typeof data.approver_id === "string"
        ? { approverType: "user" as const }
        : {}),
    ...(typeof data.approverId === "string"
      ? { approverId: data.approverId }
      : typeof data.approver_id === "string"
        ? { approverId: data.approver_id }
        : {}),
    ...(data.priority === "low" ||
    data.priority === "normal" ||
    data.priority === "high" ||
    data.priority === "urgent"
      ? { priority: data.priority }
      : {}),
    ...(typeof data.unitId === "string"
      ? { unitId: data.unitId }
      : typeof data.unit_id === "string"
        ? { unitId: data.unit_id }
        : {}),
    ...(typeof data.unitName === "string"
      ? { unitName: data.unitName }
      : typeof data.unit_name === "string"
        ? { unitName: data.unit_name }
        : {}),
    ...(typeof data.createdByUserId === "string"
      ? { createdByUserId: data.createdByUserId }
      : typeof data.created_by_user_id === "string"
        ? { createdByUserId: data.created_by_user_id }
        : createdBy && typeof createdBy.user_id === "string"
          ? { createdByUserId: createdBy.user_id }
          : {}),
    ...(typeof data.createdByUsername === "string"
      ? { createdByUsername: data.createdByUsername }
      : typeof data.created_by_username === "string"
        ? { createdByUsername: data.created_by_username }
        : createdBy && typeof createdBy.username === "string"
          ? { createdByUsername: createdBy.username }
          : {}),
    ...(normalizeStringArray(data.watcherUserIds).length > 0 ||
    normalizeStringArray(data.watcher_user_ids).length > 0
      ? {
          watcherUserIds: Array.from(
            new Set([
              ...normalizeStringArray(data.watcherUserIds),
              ...normalizeStringArray(data.watcher_user_ids),
            ])
          ),
        }
      : {}),
    ...(normalizeStringArray(data.watcherProfileIds).length > 0 ||
    normalizeStringArray(data.watcher_profile_ids).length > 0
      ? {
          watcherProfileIds: Array.from(
            new Set([
              ...normalizeStringArray(data.watcherProfileIds),
              ...normalizeStringArray(data.watcher_profile_ids),
            ])
          ),
        }
      : {}),
    ...(normalizeStringArray(data.watcherRoleIds).length > 0 ||
    normalizeStringArray(data.watcher_role_ids).length > 0
      ? {
          watcherRoleIds: Array.from(
            new Set([
              ...normalizeStringArray(data.watcherRoleIds),
              ...normalizeStringArray(data.watcher_role_ids),
            ])
          ),
        }
      : {}),
    ...(data.visibilityScope === "assignee" ||
    data.visibilityScope === "assignee_and_watchers" ||
    data.visibilityScope === "unit" ||
    data.visibilityScope === "project" ||
    data.visibilityScope === "workspace"
      ? { visibilityScope: data.visibilityScope }
      : typeof data.visibility_scope === "string"
        ? { visibilityScope: data.visibility_scope as Task["visibilityScope"] }
        : {}),
    ...(typeof data.originLink === "string"
      ? { originLink: data.originLink }
      : typeof data.origin_link === "string"
        ? { originLink: data.origin_link }
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
    ...(typeof data.cancelledAt === "string"
      ? { cancelledAt: data.cancelledAt }
      : typeof data.cancelled_at === "string"
        ? { cancelledAt: data.cancelled_at }
        : {}),
    ...(typeof data.source_status === "string"
      ? { sourceStatus: data.source_status }
      : {}),
    ...(typeof data.requires_relink_decision === "boolean"
      ? { requiresRelinkDecision: data.requires_relink_decision }
      : {}),
  };
}

function makeStatusId(scopeId: string, slug: string) {
  return `${scopeId}__${slug}`;
}

function makeProjectId(workspaceId: string, slug: string) {
  return `${workspaceId}__${slug}`;
}

function makeSubprojectId(projectId: string, slug: string) {
  return `${projectId}__${slug}`;
}

export function buildDeterministicTaskId(parts: string[]) {
  return createHash("sha256").update(parts.join("::")).digest("hex");
}

export async function ensureDefaultTaskProject(context: ServerUserContext) {
  return ensureTaskProject(context, {
    slug: DEFAULT_PROJECT_SLUG,
    name: DEFAULT_PROJECT_NAME,
    description: "Projeto padrão do novo motor de tarefas.",
  });
}

export async function ensureTaskProject(
  context: ServerUserContext,
  input: { slug: string; name: string; description?: string }
) {
  const projectId = makeProjectId(context.workspace_id, input.slug);
  const projectRef = dbAdmin.collection("task_projects").doc(projectId);

  await projectRef.set(
    {
      workspace_id: context.workspace_id,
      name: input.name,
      description: input.description ?? "",
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

  await ensureTaskSubproject(context, {
    projectId,
    slug: DEFAULT_SUBPROJECT_SLUG,
    name: DEFAULT_SUBPROJECT_NAME,
    description: "Fluxo padrão do projeto.",
  });

  return projectId;
}

export async function ensureTaskSubproject(
  context: ServerUserContext,
  input: { projectId: string; slug: string; name: string; description?: string; order?: number }
) {
  const subprojectId = makeSubprojectId(input.projectId, input.slug);
  const subprojectRef = dbAdmin.collection("task_subprojects").doc(subprojectId);
  const now = new Date().toISOString();

  await subprojectRef.set(
    {
      workspace_id: context.workspace_id,
      project_id: input.projectId,
      name: input.name,
      description: input.description ?? "",
      slug: input.slug,
      order: input.order ?? 0,
      created_at: now,
      updated_at: now,
      created_by: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
    },
    { merge: true }
  );

  await ensureTaskProjectStatuses(input.projectId, subprojectId);

  return subprojectId;
}

export async function ensureDefaultTaskSubproject(
  context: ServerUserContext,
  projectId: string
) {
  return ensureTaskSubproject(context, {
    projectId,
    slug: DEFAULT_SUBPROJECT_SLUG,
    name: DEFAULT_SUBPROJECT_NAME,
    description: "Fluxo padrão do projeto.",
  });
}

export async function ensureTaskProjectStatuses(projectId: string, subprojectId?: string) {
  const statusScopeId = subprojectId ?? projectId;
  const batch = dbAdmin.batch();
  DEFAULT_STATUSES.forEach((status) => {
    const statusId = makeStatusId(statusScopeId, status.slug);
    batch.set(
      dbAdmin.collection("task_statuses").doc(statusId),
      {
        project_id: projectId,
        ...(subprojectId ? { subproject_id: subprojectId } : {}),
        name: status.name,
        slug: status.slug,
        category: status.category,
        lifecycle_state: status.lifecycle_state,
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

export async function listTaskSubprojects(projectIds: string[]) {
  if (projectIds.length === 0) return [] as TaskSubproject[];

  const chunks: string[][] = [];
  for (let index = 0; index < projectIds.length; index += 10) {
    chunks.push(projectIds.slice(index, index + 10));
  }

  const snapshots = await Promise.all(
    chunks.map((projectIdChunk) =>
      dbAdmin
        .collection("task_subprojects")
        .where("project_id", "in", projectIdChunk)
        .get()
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs)
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<TaskSubproject, "id">) }))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name, "pt-BR"));
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

export async function listTasks(context: ServerUserContext, options?: { limit?: number }) {
  let query: FirebaseFirestore.Query = dbAdmin
    .collection("tasks")
    .where("workspace_id", "==", context.workspace_id);
  if (typeof options?.limit === "number") {
    query = query.limit(Math.min(Math.max(options.limit, 1), 500));
  }
  const snap = await query.get();

  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        raw: { id: doc.id, ...data },
        task: adaptTaskDoc(doc.id, data),
      };
    })
    .filter(({ raw, task }) => canViewTask(context, { ...raw, ...task }))
    .map(({ task }) => task)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getTaskById(taskId: string) {
  const snap = await dbAdmin.collection("tasks").doc(taskId).get();
  if (!snap.exists) return null;
  return adaptTaskDoc(snap.id, snap.data() ?? {});
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

async function resolveStatusDoc(projectId: string, status: Task["status"], subprojectId?: string) {
  const slug = status === "reopened" || status === "rejected" ? "pending" : status;
  const statusId = makeStatusId(subprojectId ?? projectId, slug);
  const snap = await dbAdmin.collection("task_statuses").doc(statusId).get();
  if (!snap.exists) {
    if (subprojectId) {
      return resolveStatusDoc(projectId, status);
    }
    throw new Error("Status da tarefa não encontrado.");
  }

  return { id: snap.id, ...(snap.data() as Omit<TaskStatusDoc, "id">) };
}

async function resolveInitialStatusDoc(projectId: string, subprojectId?: string) {
  let query: FirebaseFirestore.Query = dbAdmin
    .collection("task_statuses")
    .where("project_id", "==", projectId)
    .where("is_initial", "==", true);

  if (subprojectId) {
    query = query.where("subproject_id", "==", subprojectId);
  }

  const snap = await query.limit(1).get();

  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<TaskStatusDoc, "id">) };
  }

  return resolveStatusDoc(projectId, "pending", subprojectId);
}

export async function createManualTask(params: {
  context: ServerUserContext;
  input: {
    title: string;
    description?: string;
    assigneeType?: Task["assigneeType"];
    assigneeId?: string;
    requiresApproval?: boolean;
    approverType?: Task["approverType"];
    approverId?: string;
    dueDate?: string;
    projectId?: string;
    subprojectId?: string;
    subprojectName?: string;
    unitId?: string;
    unitName?: string;
    priority?: Task["priority"];
    watcherUserIds?: string[];
    watcherProfileIds?: string[];
    watcherRoleIds?: string[];
    visibilityScope?: Task["visibilityScope"];
    originLink?: string;
    origin?: Extract<TaskOrigin, { kind: "manual" | "legacy" }>;
    idempotencyKey?: string;
  };
}) {
  const projectId =
    typeof params.input.projectId === "string" && params.input.projectId.trim()
      ? params.input.projectId.trim()
      : await ensureDefaultTaskProject(params.context);
  const subprojectId =
    typeof params.input.subprojectId === "string" && params.input.subprojectId.trim()
      ? params.input.subprojectId.trim()
      : await ensureDefaultTaskSubproject(params.context, projectId);
  await ensureTaskProjectStatuses(projectId, subprojectId);
  const status = await resolveInitialStatusDoc(projectId, subprojectId);
  const now = new Date().toISOString();
  const history = [buildHistoryItem(params.context, "created", "Tarefa criada manualmente.")];

  const taskRef =
    typeof params.input.idempotencyKey === "string" && params.input.idempotencyKey.trim()
      ? dbAdmin.collection("tasks").doc(params.input.idempotencyKey.trim())
      : dbAdmin.collection("tasks").doc();
  if (params.input.idempotencyKey) {
    const existing = await taskRef.get();
    if (existing.exists) return adaptTaskDoc(existing.id, existing.data() ?? {});
  }
  const payload = {
    workspace_id: params.context.workspace_id,
    project_id: projectId,
    subproject_id: subprojectId,
    subprojectId,
    ...(params.input.subprojectName ? { subproject_name: params.input.subprojectName, subprojectName: params.input.subprojectName } : {}),
    status_id: status.id,
    status_slug: status.slug,
    status_name_snapshot: status.name,
    lifecycle_state: inferLifecycleFromStatusDoc(status),
    version: 0,
    title: params.input.title,
    description: params.input.description ?? "",
    assignee_type:
      params.input.assigneeType === "profile"
        ? "role"
        : params.input.assigneeType ?? "user",
    assignee_id: params.input.assigneeId ?? params.context.userDoc.id,
    requires_approval: params.input.requiresApproval === true,
    ...(params.input.approverId
      ? {
          approver_type:
            params.input.approverType === "profile"
              ? "role"
              : params.input.approverType ?? "user",
          approver_id: params.input.approverId,
        }
      : {}),
    priority: params.input.priority ?? "normal",
    ...(params.input.unitId ? { unit_id: params.input.unitId, unitId: params.input.unitId } : {}),
    ...(params.input.unitName ? { unit_name: params.input.unitName, unitName: params.input.unitName } : {}),
    ...(params.input.originLink ? { origin_link: params.input.originLink, originLink: params.input.originLink } : {}),
    watcher_user_ids: params.input.watcherUserIds ?? [],
    watcher_profile_ids: params.input.watcherProfileIds ?? [],
    watcher_role_ids: params.input.watcherRoleIds ?? [],
    watcherUserIds: params.input.watcherUserIds ?? [],
    watcherProfileIds: params.input.watcherProfileIds ?? [],
    watcherRoleIds: params.input.watcherRoleIds ?? [],
    visibility_scope:
      params.input.visibilityScope ?? (params.input.unitId ? "unit" : "assignee_and_watchers"),
    visibilityScope:
      params.input.visibilityScope ?? (params.input.unitId ? "unit" : "assignee_and_watchers"),
    origin: params.input.origin ?? { kind: "manual" },
    created_by: {
      user_id: params.context.userDoc.id,
      username: params.context.userDoc.username,
    },
    created_by_user_id: params.context.userDoc.id,
    created_by_username: params.context.userDoc.username,
    createdByUserId: params.context.userDoc.id,
    createdByUsername: params.context.userDoc.username,
    history,
    created_at: now,
    updated_at: now,
    ...(params.input.dueDate ? { due_date: params.input.dueDate } : {}),
    // Bridge fields while the UI still consumes the legacy Task shape.
    status: "pending",
    projectId,
    ...(params.input.subprojectName ? { subprojectName: params.input.subprojectName } : {}),
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
  const originDetails =
    isRecord(params.origin.details) ? params.origin.details : {};
  const originUnitId =
    typeof originDetails.unit_id === "string" && originDetails.unit_id.trim()
      ? originDetails.unit_id.trim()
      : null;
  const originUnitName =
    typeof originDetails.unit_name === "string" && originDetails.unit_name.trim()
      ? originDetails.unit_name.trim()
      : null;
  const answeredByUserId =
    typeof originDetails.answered_by_user_id === "string" &&
    originDetails.answered_by_user_id.trim()
      ? originDetails.answered_by_user_id.trim()
      : null;
  const answeredByUsername =
    typeof originDetails.answered_by_username === "string" &&
    originDetails.answered_by_username.trim()
      ? originDetails.answered_by_username.trim()
      : null;
  const originLink =
    params.origin.kind === "form_trigger"
      ? `/dashboard/forms/${params.origin.execution_id}/view`
      : params.origin.kind === "purchase_receipt"
        ? "/dashboard/purchasing/receipts"
        : null;
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
  const subprojectId =
    typeof params.trigger.task_subproject_id === "string" && params.trigger.task_subproject_id.trim()
      ? params.trigger.task_subproject_id.trim()
      : makeSubprojectId(projectId, DEFAULT_SUBPROJECT_SLUG);
  if (!params.trigger.task_subproject_id) {
    const now = new Date().toISOString();
    await dbAdmin
      .collection("task_subprojects")
      .doc(subprojectId)
      .set(
        {
          workspace_id: params.workspaceId,
          project_id: projectId,
          name: DEFAULT_SUBPROJECT_NAME,
          description: "Fluxo padrão do projeto.",
          slug: DEFAULT_SUBPROJECT_SLUG,
          order: 0,
          created_at: now,
          updated_at: now,
          created_by: params.actor,
        },
        { merge: true }
      );
  }
  await ensureTaskProjectStatuses(projectId, subprojectId);

  const pendingStatus = await resolveStatusDoc(projectId, "pending", subprojectId);

  try {
    await dbAdmin.runTransaction(async (tx) => {
      const taskSnap = await tx.get(taskRef);
      if (taskSnap.exists) {
        throw new Error("already-exists");
      }

      const now = new Date().toISOString();
      const payload = {
        workspace_id: params.workspaceId,
        project_id: projectId,
        subproject_id: subprojectId,
        subprojectId,
        status_id: pendingStatus.id,
        status_slug: pendingStatus.slug,
        status_name_snapshot: pendingStatus.name,
        lifecycle_state: inferLifecycleFromStatusDoc(pendingStatus),
        version: 0,
        title: params.title,
        description: params.description ?? "",
        assignee_type:
          params.trigger.assignee_type === "role" ||
          params.trigger.assignee_type === "team" ||
          params.trigger.assignee_type === "unit"
            ? params.trigger.assignee_type
            : "user",
        assignee_id: params.trigger.assignee_id,
        assignee_name: params.trigger.assignee_name ?? null,
        requires_approval: params.trigger.requires_approval,
        approver_id: params.trigger.approver_id ?? null,
        approver_name: params.trigger.approver_name ?? null,
        priority: "normal",
        ...(originUnitId ? { unit_id: originUnitId, unitId: originUnitId } : {}),
        ...(originUnitName ? { unit_name: originUnitName, unitName: originUnitName } : {}),
        ...(originLink ? { origin_link: originLink, originLink } : {}),
        watcher_user_ids: answeredByUserId ? [answeredByUserId] : [],
        watcherUserIds: answeredByUserId ? [answeredByUserId] : [],
        visibility_scope: originUnitId ? "unit" : "assignee_and_watchers",
        visibilityScope: originUnitId ? "unit" : "assignee_and_watchers",
        created_by: {
          user_id: params.actor.user_id,
          username: params.actor.username,
        },
        created_by_user_id: answeredByUserId ?? params.actor.user_id,
        created_by_username: answeredByUsername ?? params.actor.username,
        createdByUserId: answeredByUserId ?? params.actor.user_id,
        createdByUsername: answeredByUsername ?? params.actor.username,
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
        assigneeType:
          params.trigger.assignee_type === "role"
            ? "profile"
            : params.trigger.assignee_type === "team" ||
                params.trigger.assignee_type === "unit"
              ? params.trigger.assignee_type
              : "user",
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
  assertTaskWorkspace(data, params.context);
  const currentTask = adaptTaskDoc(params.taskId, data);
  if (!canViewTask(params.context, { ...data, ...currentTask })) {
    const error = new Error("Tarefa fora do seu escopo de acesso.");
    (error as Error & { code?: number }).code = 403;
    throw error;
  }
  if (
    typeof params.updates.unitId === "string" &&
    !canAccessUnit(params.context.userDoc, params.updates.unitId, {
      isDefaultAdmin: params.context.isDefaultAdmin,
    })
  ) {
    const error = new Error("A unidade da tarefa está fora do seu escopo de acesso.");
    (error as Error & { code?: number }).code = 403;
    throw error;
  }
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
    version: FieldValue.increment(1),
  };

  if (typeof params.updates.title === "string") nextData.title = params.updates.title;
  if (typeof params.updates.description === "string") nextData.description = params.updates.description;
  if (typeof params.updates.projectId === "string") {
    nextData.projectId = params.updates.projectId;
    nextData.project_id = params.updates.projectId;
  }
  if (typeof params.updates.subprojectId === "string") {
    nextData.subprojectId = params.updates.subprojectId;
    nextData.subproject_id = params.updates.subprojectId;
  }
  if (typeof params.updates.subprojectName === "string") {
    nextData.subprojectName = params.updates.subprojectName;
    nextData.subproject_name = params.updates.subprojectName;
  }
  if (typeof params.updates.status === "string") {
    const projectId =
      typeof nextData.project_id === "string"
        ? nextData.project_id
        : typeof data.project_id === "string"
          ? data.project_id
          : await ensureDefaultTaskProject(params.context);
    const subprojectId =
      typeof nextData.subproject_id === "string"
        ? nextData.subproject_id
        : typeof data.subproject_id === "string"
          ? data.subproject_id
          : undefined;
    const statusDoc = await resolveStatusDoc(projectId, params.updates.status, subprojectId);
    const lifecycleState = inferLifecycleFromTaskStatus(
      params.updates.status,
      statusDoc
    );
    const nextStatus =
      params.updates.status === "reopened" ? "pending" : params.updates.status;
    nextData.status_id = statusDoc.id;
    nextData.status_slug = statusDoc.slug;
    nextData.status_name_snapshot = statusDoc.name;
    nextData.lifecycle_state = lifecycleState;
    nextData.status = nextStatus;
    nextData.statusId = statusDoc.id;
    if (params.updates.status === "completed" && !params.updates.completedAt) {
      nextData.completed_at = new Date().toISOString();
      nextData.completedAt = nextData.completed_at;
    }
    if (params.updates.status === "pending" || params.updates.status === "reopened") {
      nextData.completed_at = null;
      nextData.completedAt = null;
    }
    if (nextStatus === "completed") {
      const hasLinkedOccurrence = await hasActiveOccurrenceLink(
        checklistDbAdmin,
        params.taskId
      );
      nextData.completion_result = resolveCompletionResult(
        normalizeCompletionResult(params.updates.completionResult),
        hasLinkedOccurrence
      );
      nextData.completed_by = params.context.userDoc.id;
    } else if (isTaskCompletionResult(data.completion_result)) {
      nextData.completion_result = null;
      nextData.completed_by = null;
    }
  }
  if (typeof params.updates.assigneeType === "string") {
    nextData.assigneeType = params.updates.assigneeType;
    nextData.assignee_type =
      params.updates.assigneeType === "profile" ? "role" : params.updates.assigneeType;
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
      params.updates.approverType === "profile" ? "role" : params.updates.approverType;
  }
  if (typeof params.updates.approverId === "string") {
    nextData.approverId = params.updates.approverId;
    nextData.approver_id = params.updates.approverId;
  }
  if (typeof params.updates.dueDate === "string") {
    nextData.dueDate = params.updates.dueDate;
    nextData.due_date = params.updates.dueDate;
  }
  if (typeof params.updates.priority === "string") {
    nextData.priority = params.updates.priority;
  }
  if (typeof params.updates.unitId === "string") {
    nextData.unitId = params.updates.unitId;
    nextData.unit_id = params.updates.unitId;
  }
  if (typeof params.updates.unitName === "string") {
    nextData.unitName = params.updates.unitName;
    nextData.unit_name = params.updates.unitName;
  }
  if (typeof params.updates.createdByUserId === "string") {
    nextData.createdByUserId = params.updates.createdByUserId;
    nextData.created_by_user_id = params.updates.createdByUserId;
  }
  if (typeof params.updates.createdByUsername === "string") {
    nextData.createdByUsername = params.updates.createdByUsername;
    nextData.created_by_username = params.updates.createdByUsername;
  }
  if (Array.isArray(params.updates.watcherUserIds)) {
    nextData.watcherUserIds = params.updates.watcherUserIds;
    nextData.watcher_user_ids = params.updates.watcherUserIds;
  }
  if (Array.isArray(params.updates.watcherProfileIds)) {
    nextData.watcherProfileIds = params.updates.watcherProfileIds;
    nextData.watcher_profile_ids = params.updates.watcherProfileIds;
  }
  if (Array.isArray(params.updates.watcherRoleIds)) {
    nextData.watcherRoleIds = params.updates.watcherRoleIds;
    nextData.watcher_role_ids = params.updates.watcherRoleIds;
  }
  if (typeof params.updates.visibilityScope === "string") {
    nextData.visibilityScope = params.updates.visibilityScope;
    nextData.visibility_scope = params.updates.visibilityScope;
  }
  if (typeof params.updates.originLink === "string") {
    nextData.originLink = params.updates.originLink;
    nextData.origin_link = params.updates.originLink;
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
  if (typeof params.updates.status === "string") {
    await syncOccurrencesFromTask(TASK_OCCURRENCE_SYNC_DEPS, params.taskId);
  }

  return updatedTask;
}

export async function updateTaskStatus(params: {
  context: ServerUserContext;
  taskId: string;
  status: Task["status"];
  completionResult?: TaskCompletionResult;
  details?: string;
  allowOriginStatusChange?: boolean;
}) {
  const taskRef = dbAdmin.collection("tasks").doc(params.taskId);
  const snap = await taskRef.get();
  if (!snap.exists) {
    throw new Error("Tarefa não encontrada.");
  }

  const data = snap.data() as FirestoreRecord;
  assertTaskWorkspace(data, params.context);
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
  if (!canActOnTask(params.context, { ...data, ...currentTask })) {
    const error = new Error("Sem permissão para atuar nesta tarefa ou unidade.");
    (error as Error & { code?: number }).code = 403;
    throw error;
  }
  const projectId =
    typeof data.project_id === "string"
      ? data.project_id
      : await ensureDefaultTaskProject(params.context);
  const subprojectId =
    typeof data.subproject_id === "string" ? data.subproject_id : undefined;
  const statusDoc = await resolveStatusDoc(projectId, params.status, subprojectId);
  const lifecycleState = inferLifecycleFromTaskStatus(params.status, statusDoc);

  let action: TaskHistoryItem["action"] = "status_changed";
  if (params.status === "completed") {
    action = currentTask.status === "awaiting_approval" ? "approved" : "completed";
  }
  if (params.status === "awaiting_approval") action = "status_changed";
  if (params.status === "reopened" || params.status === "pending") {
    action = currentTask.status === "awaiting_approval" ? "rejected" : "reopened";
  }

  const now = new Date().toISOString();
  const history = [
    ...currentTask.history,
    buildHistoryItem(params.context, action, params.details),
  ];

  const nextStatus = params.status === "reopened" ? "pending" : params.status;
  const completedAt = nextStatus === "completed" ? now : null;
  const completionPatch: FirestoreRecord = {};
  if (nextStatus === "completed") {
    const hasLinkedOccurrence = await hasActiveOccurrenceLink(
      checklistDbAdmin,
      params.taskId
    );
    completionPatch.completion_result = resolveCompletionResult(
      params.completionResult,
      hasLinkedOccurrence
    );
    completionPatch.completed_by = params.context.userDoc.id;
  } else if (isTaskCompletionResult(data.completion_result)) {
    completionPatch.completion_result = null;
    completionPatch.completed_by = null;
  }

  const payload: FirestoreRecord = {
    status_id: statusDoc.id,
    status_slug: statusDoc.slug,
    status_name_snapshot: statusDoc.name,
    status: nextStatus,
    lifecycle_state: lifecycleState,
    history,
    updated_at: now,
    updatedAt: now,
    completed_at: completedAt,
    completedAt,
    version: FieldValue.increment(1),
    ...completionPatch,
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
  await syncOccurrencesFromTask(TASK_OCCURRENCE_SYNC_DEPS, params.taskId);

  return updatedTask;
}

export function isDefaultTaskProjectId(workspaceId: string, projectId: string) {
  return projectId === makeProjectId(workspaceId, DEFAULT_PROJECT_SLUG);
}

export async function deleteTaskDocument(params: {
  context: ServerUserContext;
  taskId: string;
}) {
  const ref = dbAdmin.collection("tasks").doc(params.taskId);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error("Tarefa não encontrada.");
    (error as Error & { code?: number }).code = 404;
    throw error;
  }
  const data = (snap.data() ?? {}) as FirestoreRecord;
  assertTaskWorkspace(data, params.context);
  const currentTask = adaptTaskDoc(params.taskId, data);
  if (!canViewTask(params.context, { ...data, ...currentTask })) {
    const error = new Error("Tarefa fora do seu escopo de acesso.");
    (error as Error & { code?: number }).code = 403;
    throw error;
  }
  await ref.delete();
}
