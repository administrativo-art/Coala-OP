import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import {
  decideOccurrenceEffect,
  decideValidationApproval,
  decideValidationRejection,
  isTaskCompletionResult,
  isTaskLifecycleState,
  resolveCompletionResult,
  ResolutionFlowError,
  type OccurrenceSyncView,
  type RejectionNextAction,
} from "./task-sync-core";
import {
  LINK_TYPES,
  OCCURRENCE_TASK_LINKS_COLLECTION,
  SEED_TASK_STATUSES,
  TASK_COMPLETION_RESULTS,
  TASK_LIFECYCLE_STATES,
  TASK_STATUS_DEFINITIONS_COLLECTION,
  type FormOccurrenceTaskLink,
  type LinkDeactivationReason,
  type LinkType,
  type TaskCompletionResult,
  type TaskLifecycleState,
  type TaskView,
} from "./task-model";
import { ANALYTICS_COLLECTIONS } from "./types";

export interface TaskIntegrationDeps {
  db: Firestore;
  taskDb?: Firestore;
  tasksCollection: string;
  createFollowUpTask?: (params: {
    workspace_id: string;
    occurrence_id: string;
    reason: string;
    created_by: string;
  }) => Promise<{ id: string }>;
}

const now = () => FieldValue.serverTimestamp();

function getTaskDb(deps: TaskIntegrationDeps) {
  return deps.taskDb ?? deps.db;
}

export async function seedTaskStatuses(
  db: Firestore,
  workspaceId: string
): Promise<number> {
  const collection = db.collection(TASK_STATUS_DEFINITIONS_COLLECTION);
  let created = 0;

  for (const status of SEED_TASK_STATUSES) {
    const id = `${workspaceId}__seed_status_${status.lifecycle_state}`;
    const snap = await collection.doc(id).get();
    if (snap.exists) continue;

    await collection.doc(id).create({
      ...status,
      workspace_id: workspaceId,
      created_at: now(),
      updated_at: now(),
    });
    created += 1;
  }

  return created;
}

export async function linkOccurrenceToTask(
  deps: TaskIntegrationDeps,
  params: {
    workspaceId: string;
    occurrenceId: string;
    taskId: string;
    linkType: LinkType;
    createdBy: string;
    previousLinkId?: string;
  }
): Promise<string> {
  const parsedLinkType = parseLinkType(params.linkType);
  const ref = deps.db.collection(OCCURRENCE_TASK_LINKS_COLLECTION).doc();

  await ref.create({
    workspace_id: params.workspaceId,
    occurrence_id: params.occurrenceId,
    task_id: params.taskId,
    link_type: parsedLinkType,
    link_status: "active",
    is_active: true,
    ...(params.previousLinkId
      ? { previous_link_id: params.previousLinkId }
      : {}),
    created_at: now(),
    created_by: params.createdBy,
  });

  if (params.previousLinkId) {
    await deps.db
      .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
      .doc(params.previousLinkId)
      .update({ next_link_id: ref.id });
  }

  await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(params.occurrenceId)
    .update({
      has_active_task: true,
      current_primary_task_id: params.taskId,
      task_created_at: now(),
      updated_at: now(),
    });

  return ref.id;
}

export interface OccurrenceTaskSeed {
  occurrence_id: string;
  template_item_id: string;
  task_trigger_id?: string;
  item_title_snapshot: string;
  target_name_snapshot: string;
  domain_name_snapshot: string;
  result_name_snapshot: string;
  severity?: string;
  description?: string;
  answer_label?: string;
  option_label_snapshot?: string;
  unit_id?: string;
  unit_name_snapshot?: string;
}

const OPEN_RESOLUTION_STATUSES = new Set([
  "open",
  "in_progress",
  "waiting",
  "blocked",
  "pending_validation",
]);

async function activeLinkByOccurrence(db: Firestore, occurrenceId: string) {
  const snap = await db
    .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
    .where("occurrence_id", "==", occurrenceId)
    .where("is_active", "==", true)
    .limit(1)
    .get();

  return snap.docs[0] ?? null;
}

export async function ensureTasksForOccurrences(
  deps: TaskIntegrationDeps,
  params: {
    workspaceId: string;
    executionId: string;
    createdBy: string;
    createTask: (seed: OccurrenceTaskSeed) => Promise<{ id: string } | null>;
  }
): Promise<{ tasks_linked: number; skipped: number }> {
  const snap = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", params.workspaceId)
    .where("execution_id", "==", params.executionId)
    .where("is_current", "==", true)
    .where("create_task", "==", true)
    .get();

  let tasksLinked = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.record_type !== "occurrence") continue;
    if (!OPEN_RESOLUTION_STATUSES.has(String(data.resolution_status))) continue;

    const existingLink = await activeLinkByOccurrence(deps.db, doc.id);
    if (existingLink) {
      // Retry técnico reescreveu o doc por dedupe_key; restaura o snapshot do vínculo.
      if (data.has_active_task !== true) {
        await doc.ref.update({
          has_active_task: true,
          current_primary_task_id: String(existingLink.get("task_id") ?? ""),
          updated_at: now(),
        });
      }
      skipped += 1;
      continue;
    }

    const task = await params.createTask({
      occurrence_id: doc.id,
      template_item_id: String(data.template_item_id ?? ""),
      task_trigger_id:
        typeof data.task_trigger_id === "string" ? data.task_trigger_id : undefined,
      item_title_snapshot: String(data.item_title_snapshot ?? ""),
      target_name_snapshot: String(data.target_name_snapshot ?? ""),
      domain_name_snapshot: String(data.domain_name_snapshot ?? ""),
      result_name_snapshot: String(data.result_name_snapshot ?? ""),
      severity: typeof data.severity === "string" ? data.severity : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
      answer_label:
        typeof data.answer_label === "string" ? data.answer_label : undefined,
      option_label_snapshot:
        typeof data.option_label_snapshot === "string"
          ? data.option_label_snapshot
          : undefined,
      unit_id: typeof data.unit_id === "string" ? data.unit_id : undefined,
      unit_name_snapshot:
        typeof data.unit_name_snapshot === "string"
          ? data.unit_name_snapshot
          : undefined,
    });

    if (!task) {
      skipped += 1;
      continue;
    }

    await linkOccurrenceToTask(deps, {
      workspaceId: params.workspaceId,
      occurrenceId: doc.id,
      taskId: task.id,
      linkType: "primary",
      createdBy: params.createdBy,
    });
    await syncOccurrencesFromTask(deps, task.id);
    tasksLinked += 1;
  }

  return { tasks_linked: tasksLinked, skipped };
}

export async function hasActiveOccurrenceLink(
  db: Firestore,
  taskId: string
) {
  const snap = await db
    .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
    .where("task_id", "==", taskId)
    .where("is_active", "==", true)
    .limit(1)
    .get();

  return !snap.empty;
}

async function deactivateLink(
  db: Firestore,
  linkId: string,
  status: "inactive" | "orphaned" | "cancelled",
  reason: LinkDeactivationReason,
  by?: string
) {
  await db.collection(OCCURRENCE_TASK_LINKS_COLLECTION).doc(linkId).update({
    link_status: status,
    is_active: false,
    deactivation_reason: reason,
    deactivated_at: now(),
    ...(by ? { deactivated_by: by } : {}),
  });
}

async function activeLinksByTask(
  db: Firestore,
  taskId: string
): Promise<Array<{ id: string; data: FormOccurrenceTaskLink }>> {
  const snap = await db
    .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
    .where("task_id", "==", taskId)
    .where("is_active", "==", true)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as FormOccurrenceTaskLink,
  }));
}

export async function completeTask(
  deps: TaskIntegrationDeps,
  params: {
    taskId: string;
    completedBy: string;
    completionResult?: TaskCompletionResult;
    completionNote?: string;
  }
) {
  const links = await activeLinksByTask(deps.db, params.taskId);
  const result = resolveCompletionResult(
    params.completionResult,
    links.length > 0
  );
  const completedAt = new Date();
  const completedAtIso = completedAt.toISOString();

  await getTaskDb(deps)
    .collection(deps.tasksCollection)
    .doc(params.taskId)
    .update({
      lifecycle_state: "completed",
      status: "completed",
      completion_result: result,
      ...(params.completionNote
        ? { completion_note: params.completionNote }
        : {}),
      completed_at: completedAtIso,
      completedAt: completedAtIso,
      completed_by: params.completedBy,
      version: FieldValue.increment(1),
      updated_at: completedAtIso,
      updatedAt: completedAtIso,
    });

  await syncOccurrencesFromTask(deps, params.taskId);
}

export async function cancelTask(
  deps: TaskIntegrationDeps,
  params: { taskId: string; cancelledBy: string }
) {
  const cancelledAt = new Date().toISOString();
  await getTaskDb(deps)
    .collection(deps.tasksCollection)
    .doc(params.taskId)
    .update({
      lifecycle_state: "cancelled",
      completion_result: "cancelled",
      cancelled_at: cancelledAt,
      cancelled_by: params.cancelledBy,
      version: FieldValue.increment(1),
      updated_at: cancelledAt,
      updatedAt: cancelledAt,
    });

  await syncOccurrencesFromTask(deps, params.taskId);
}

export async function changeTaskStatus(
  deps: TaskIntegrationDeps,
  params: { taskId: string; statusId: string; changedBy: string }
) {
  const status = await loadTaskStatusDefinition(deps, params.statusId);
  if (!status) {
    throw new Error(`Status de tarefa inexistente/inativo: ${params.statusId}`);
  }
  if (status.lifecycle_state === "completed") {
    throw new Error(
      'Status terminal "completed" so pode ser aplicado por completeTask.'
    );
  }

  const updatedAt = new Date().toISOString();
  await getTaskDb(deps)
    .collection(deps.tasksCollection)
    .doc(params.taskId)
    .update({
      status_id: params.statusId,
      status_name_snapshot: status.name,
      lifecycle_state: status.lifecycle_state,
      version: FieldValue.increment(1),
      updated_at: updatedAt,
      updatedAt,
    });

  await syncOccurrencesFromTask(deps, params.taskId);
}

export async function syncOccurrencesFromTask(
  deps: TaskIntegrationDeps,
  taskId: string
) {
  const links = await activeLinksByTask(deps.db, taskId);
  if (links.length === 0) return;

  const taskSnap = await getTaskDb(deps)
    .collection(deps.tasksCollection)
    .doc(taskId)
    .get();
  if (!taskSnap.exists) return;

  const task = toTaskView(taskSnap.id, taskSnap.data() ?? {});
  for (const link of links) {
    await runSyncTransaction(deps, link.id, link.data.occurrence_id, task);
  }
}

function toTaskView(
  id: string,
  data: FirebaseFirestore.DocumentData
): TaskView {
  return {
    id,
    workspace_id: String(data.workspace_id ?? ""),
    lifecycle_state: inferLifecycleState(data),
    status_id:
      typeof data.status_id === "string" ? data.status_id : undefined,
    status_name_snapshot:
      typeof data.status_name_snapshot === "string"
        ? data.status_name_snapshot
        : typeof data.status_slug === "string"
          ? data.status_slug
          : undefined,
    completion_result: isTaskCompletionResult(data.completion_result)
      ? data.completion_result
      : undefined,
    completed_at: toDate(data.completed_at ?? data.completedAt),
    completed_by:
      typeof data.completed_by === "string" ? data.completed_by : undefined,
    cancelled_at: toDate(data.cancelled_at),
    version: typeof data.version === "number" ? data.version : 0,
  };
}

function toOccurrenceSyncView(
  id: string,
  data: FirebaseFirestore.DocumentData
): OccurrenceSyncView {
  return {
    id,
    is_current: data.is_current === true,
    record_status:
      data.record_status === "superseded" || data.record_status === "cancelled"
        ? data.record_status
        : "valid",
    resolution_status: data.resolution_status,
    resolution_behavior: data.resolution_behavior ?? "none",
    resolution_source:
      typeof data.resolution_source === "string"
        ? data.resolution_source
        : undefined,
    occurred_at: toDate(data.occurred_at) ?? new Date(0),
    first_action_at: toDate(data.first_action_at),
    last_task_version_synced:
      typeof data.last_task_version_synced === "number"
        ? data.last_task_version_synced
        : undefined,
  };
}

async function runSyncTransaction(
  deps: TaskIntegrationDeps,
  linkId: string,
  occurrenceId: string,
  task: TaskView
) {
  const occurrenceRef = deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(occurrenceId);
  const linkRef = deps.db
    .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
    .doc(linkId);

  await deps.db.runTransaction(async (transaction) => {
    const [occurrenceSnap, linkSnap] = await Promise.all([
      transaction.get(occurrenceRef),
      transaction.get(linkRef),
    ]);
    if (!occurrenceSnap.exists || linkSnap.get("is_active") !== true) {
      return;
    }

    const occurrence = toOccurrenceSyncView(
      occurrenceSnap.id,
      occurrenceSnap.data() ?? {}
    );
    const effect = decideOccurrenceEffect(occurrence, task);
    const syncMarker = {
      last_task_version_synced: task.version,
      last_task_sync_at: now(),
      last_task_id: task.id,
      last_task_lifecycle_state: task.lifecycle_state,
      last_task_status_snapshot: task.status_name_snapshot ?? null,
      last_task_completion_result: task.completion_result ?? null,
      updated_at: now(),
    };

    switch (effect.kind) {
      case "noop":
        if (effect.reason !== "stale_version") {
          transaction.update(occurrenceRef, syncMarker);
          transaction.update(linkRef, {
            last_synced_task_version: task.version,
          });
        }
        return;

      case "update_status":
        transaction.update(occurrenceRef, {
          ...syncMarker,
          resolution_status: effect.resolution_status,
          ...(effect.set_first_action_at
            ? {
                first_action_at: Timestamp.fromDate(
                  effect.set_first_action_at
                ),
              }
            : {}),
        });
        transaction.update(linkRef, {
          last_synced_task_version: task.version,
        });
        return;

      case "pending_validation":
        transaction.update(occurrenceRef, {
          ...syncMarker,
          resolution_status: "pending_validation",
          task_completed_at: task.completed_at
            ? Timestamp.fromDate(task.completed_at)
            : now(),
        });
        transaction.update(linkRef, {
          last_synced_task_version: task.version,
        });
        return;

      case "resolve":
        transaction.update(occurrenceRef, {
          ...syncMarker,
          resolution_status: "resolved",
          resolved_at: Timestamp.fromDate(effect.resolved_at),
          resolved_by: effect.resolved_by ?? null,
          resolution_source: effect.resolution_source,
          resolution_time_minutes: effect.resolution_time_minutes,
          ...(effect.time_to_first_action_minutes !== undefined
            ? {
                time_to_first_action_minutes:
                  effect.time_to_first_action_minutes,
              }
            : {}),
          task_completed_at: Timestamp.fromDate(effect.resolved_at),
        });
        transaction.update(linkRef, {
          last_synced_task_version: task.version,
        });
        return;

      case "task_cancelled":
        transaction.update(occurrenceRef, {
          ...syncMarker,
          resolution_status: "open",
          has_active_task: false,
          current_primary_task_id: null,
        });
        transaction.update(linkRef, {
          link_status: "cancelled",
          is_active: false,
          deactivation_reason: "task_cancelled",
          deactivated_at: now(),
          last_synced_task_version: task.version,
        });
    }
  });
}

export class OccurrenceActionError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid_state"
  ) {
    super(message);
    this.name = "OccurrenceActionError";
  }
}

function assertActionableOccurrence(data: FirebaseFirestore.DocumentData) {
  if (data.record_type !== "occurrence") {
    throw new OccurrenceActionError(
      "Apenas ocorrências têm tratativa operacional.",
      "invalid_state"
    );
  }
  if (data.is_current !== true || data.record_status !== "valid") {
    throw new OccurrenceActionError(
      "Ocorrência substituída ou cancelada não pode ser tratada.",
      "invalid_state"
    );
  }
  if (!OPEN_RESOLUTION_STATUSES.has(String(data.resolution_status))) {
    throw new OccurrenceActionError(
      `Ocorrência em "${String(data.resolution_status)}" não permite esta ação.`,
      "invalid_state"
    );
  }
}

export async function resolveOccurrenceManually(
  deps: TaskIntegrationDeps,
  params: { occurrenceId: string; resolvedBy: string; note?: string }
) {
  const ref = deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(params.occurrenceId);

  await deps.db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new OccurrenceActionError("Ocorrência não encontrada.", "not_found");
    }
    const data = snap.data() ?? {};
    assertActionableOccurrence(data);

    const resolvedAt = new Date();
    const occurredAt = toDate(data.occurred_at) ?? resolvedAt;
    const firstActionAt = toDate(data.first_action_at);

    transaction.update(ref, {
      resolution_status: "resolved",
      resolved_at: Timestamp.fromDate(resolvedAt),
      resolved_by: params.resolvedBy,
      resolution_source: "manual_resolution",
      resolution_time_minutes: differenceInMinutes(resolvedAt, occurredAt),
      ...(firstActionAt
        ? {}
        : { first_action_at: Timestamp.fromDate(resolvedAt) }),
      ...(params.note ? { resolution_note: params.note } : {}),
      updated_at: now(),
      updated_by: params.resolvedBy,
    });
  });
}

export async function cancelOccurrenceManually(
  deps: TaskIntegrationDeps,
  params: { occurrenceId: string; cancelledBy: string; reason?: string }
) {
  const ref = deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(params.occurrenceId);

  await deps.db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new OccurrenceActionError("Ocorrência não encontrada.", "not_found");
    }
    const data = snap.data() ?? {};
    assertActionableOccurrence(data);

    transaction.update(ref, {
      resolution_status: "cancelled",
      resolution_source: "manual_resolution",
      has_active_task: false,
      current_primary_task_id: null,
      ...(params.reason ? { resolution_note: params.reason } : {}),
      updated_at: now(),
      updated_by: params.cancelledBy,
    });
  });

  const links = await deps.db
    .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
    .where("occurrence_id", "==", params.occurrenceId)
    .where("is_active", "==", true)
    .get();
  for (const link of links.docs) {
    await deactivateLink(
      deps.db,
      link.id,
      "cancelled",
      "occurrence_cancelled",
      params.cancelledBy
    );
  }
}

function differenceInMinutes(later: Date, earlier: Date) {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 60000));
}

export async function validateOccurrenceResolution(
  deps: TaskIntegrationDeps,
  params: { occurrenceId: string; approvedBy: string }
) {
  const ref = deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(params.occurrenceId);

  await deps.db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Ocorrencia nao encontrada.");

    const occurrence = toOccurrenceSyncView(snap.id, snap.data() ?? {});
    const patch = decideValidationApproval(occurrence, {
      approved_at: new Date(),
      approved_by: params.approvedBy,
    });

    transaction.update(ref, {
      resolution_status: patch.resolution_status,
      resolved_at: Timestamp.fromDate(patch.resolved_at),
      resolved_by: patch.resolved_by,
      resolution_source: patch.resolution_source,
      resolution_time_minutes: patch.resolution_time_minutes,
      updated_at: now(),
    });
  });
}

export async function rejectOccurrenceResolution(
  deps: TaskIntegrationDeps,
  params: {
    occurrenceId: string;
    rejectedBy: string;
    rejectionReason: string;
    nextAction: RejectionNextAction;
  }
): Promise<{ followUpTaskId?: string }> {
  const ref = deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(params.occurrenceId);
  let workspaceId: string | null = null;
  let oldLinkId: string | undefined;

  await deps.db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Ocorrencia nao encontrada.");

    workspaceId = String(snap.get("workspace_id") ?? "");
    const occurrence = toOccurrenceSyncView(snap.id, snap.data() ?? {});
    decideValidationRejection(occurrence);

    const linkSnap = await transaction.get(
      deps.db
        .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
        .where("occurrence_id", "==", params.occurrenceId)
        .where("is_active", "==", true)
        .limit(1)
    );
    oldLinkId = linkSnap.docs[0]?.id;

    transaction.update(ref, {
      resolution_status: "open",
      resolved_at: FieldValue.delete(),
      resolved_by: FieldValue.delete(),
      resolution_source: FieldValue.delete(),
      resolution_time_minutes: FieldValue.delete(),
      has_active_task: false,
      current_primary_task_id: null,
      updated_at: now(),
    });

    if (oldLinkId) {
      transaction.update(
        deps.db.collection(OCCURRENCE_TASK_LINKS_COLLECTION).doc(oldLinkId),
        {
          link_status: "inactive",
          is_active: false,
          deactivation_reason: "validation_rejected",
          deactivated_at: now(),
          deactivated_by: params.rejectedBy,
        }
      );
    }
  });

  if (params.nextAction !== "create_follow_up_task") return {};
  if (!deps.createFollowUpTask) {
    throw new ResolutionFlowError(
      "nextAction=create_follow_up_task exige deps.createFollowUpTask.",
      "factory_required"
    );
  }
  if (!workspaceId) throw new Error("Workspace da ocorrencia nao encontrado.");

  const followUp = await deps.createFollowUpTask({
    workspace_id: workspaceId,
    occurrence_id: params.occurrenceId,
    reason: params.rejectionReason,
    created_by: params.rejectedBy,
  });

  await linkOccurrenceToTask(deps, {
    workspaceId,
    occurrenceId: params.occurrenceId,
    taskId: followUp.id,
    linkType: "follow_up",
    createdBy: params.rejectedBy,
    previousLinkId: oldLinkId,
  });

  return { followUpTaskId: followUp.id };
}

export async function orphanLinksForExecution(
  deps: TaskIntegrationDeps,
  workspaceId: string,
  executionId: string
): Promise<number> {
  const occurrences = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("execution_id", "==", executionId)
    .where("is_current", "==", false)
    .select()
    .get();
  if (occurrences.empty) return 0;

  let count = 0;
  for (const occurrence of occurrences.docs) {
    const links = await deps.db
      .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
      .where("occurrence_id", "==", occurrence.id)
      .where("is_active", "==", true)
      .get();

    for (const link of links.docs) {
      await deactivateLink(
        deps.db,
        link.id,
        "orphaned",
        "occurrence_superseded"
      );
      await getTaskDb(deps)
        .collection(deps.tasksCollection)
        .doc(String(link.get("task_id")))
        .update({
          source_status: "source_occurrence_superseded",
          requires_relink_decision: true,
          updated_at: new Date().toISOString(),
        });
      count += 1;
    }
  }

  return count;
}

export async function relinkTasksForExecution(
  deps: TaskIntegrationDeps,
  workspaceId: string,
  executionId: string,
  relinkedBy: string
): Promise<{ relinked: number; unmatched_task_ids: string[] }> {
  const current = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("execution_id", "==", executionId)
    .where("is_current", "==", true)
    .get();

  const currentByIdentity = new Map<string, string>();
  for (const doc of current.docs) {
    const identityKey = doc.get("occurrence_identity_key");
    if (typeof identityKey === "string") {
      currentByIdentity.set(identityKey, doc.id);
    }
  }

  const old = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("execution_id", "==", executionId)
    .where("is_current", "==", false)
    .get();

  let relinked = 0;
  const unmatched: string[] = [];

  for (const oldOccurrence of old.docs) {
    const links = await deps.db
      .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
      .where("occurrence_id", "==", oldOccurrence.id)
      .where("link_status", "==", "orphaned")
      .get();
    if (links.empty) continue;

    const oldIdentityKey = oldOccurrence.get("occurrence_identity_key");
    const newOccurrenceId =
      typeof oldIdentityKey === "string"
        ? currentByIdentity.get(oldIdentityKey)
        : undefined;

    for (const link of links.docs) {
      const taskId = String(link.get("task_id") ?? "");
      if (!newOccurrenceId) {
        unmatched.push(taskId);
        continue;
      }

      await deps.db
        .collection(OCCURRENCE_TASK_LINKS_COLLECTION)
        .doc(link.id)
        .update({ deactivation_reason: "relinked_to_new_occurrence" });
      await linkOccurrenceToTask(deps, {
        workspaceId,
        occurrenceId: newOccurrenceId,
        taskId,
        linkType: "primary",
        createdBy: relinkedBy,
        previousLinkId: link.id,
      });
      await getTaskDb(deps).collection(deps.tasksCollection).doc(taskId).update({
        source_status: FieldValue.delete(),
        requires_relink_decision: FieldValue.delete(),
        version: FieldValue.increment(1),
        updated_at: new Date().toISOString(),
      });
      await syncOccurrencesFromTask(deps, taskId);
      relinked += 1;
    }
  }

  return { relinked, unmatched_task_ids: unmatched };
}

async function loadTaskStatusDefinition(
  deps: TaskIntegrationDeps,
  statusId: string
): Promise<{
  name: string;
  lifecycle_state: TaskLifecycleState;
} | null> {
  const taskDb = getTaskDb(deps);
  const canonicalSnap = await taskDb
    .collection(TASK_STATUS_DEFINITIONS_COLLECTION)
    .doc(statusId)
    .get();
  if (canonicalSnap.exists && canonicalSnap.get("is_active") !== false) {
    return {
      name: String(canonicalSnap.get("name") ?? statusId),
      lifecycle_state: inferLifecycleState(canonicalSnap.data() ?? {}),
    };
  }

  const legacySnap = await taskDb.collection("task_statuses").doc(statusId).get();
  if (!legacySnap.exists) return null;

  return {
    name: String(legacySnap.get("name") ?? statusId),
    lifecycle_state: inferLifecycleState(legacySnap.data() ?? {}),
  };
}

function inferLifecycleState(
  data: FirebaseFirestore.DocumentData
): TaskLifecycleState {
  if (isTaskLifecycleState(data.lifecycle_state)) return data.lifecycle_state;

  const status = String(data.status ?? data.status_slug ?? data.slug ?? "");
  if (status === "in_progress") return "in_progress";
  if (status === "awaiting_approval") return "waiting";
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "canceled") return "cancelled";

  const category = String(data.category ?? "");
  if (category === "active") return "in_progress";
  if (category === "done") return "completed";
  if (category === "canceled") return "cancelled";

  return "open";
}

function parseLinkType(value: string): LinkType {
  if ((LINK_TYPES as readonly string[]).includes(value)) {
    return value as LinkType;
  }
  throw new Error(`Tipo de vinculo invalido: ${value}`);
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  if (value instanceof Timestamp) return value.toDate();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate();
  }
  return undefined;
}

export { TASK_COMPLETION_RESULTS, TASK_LIFECYCLE_STATES };
