import type { AnalyticsResolutionStatus } from "./occurrence-model";
import type {
  TaskCompletionResult,
  TaskLifecycleState,
  TaskView,
} from "./task-model";

export interface OccurrenceSyncView {
  id: string;
  is_current: boolean;
  record_status: "valid" | "superseded" | "cancelled";
  resolution_status: AnalyticsResolutionStatus;
  resolution_behavior:
    | "none"
    | "auto_resolve_on_task_completion"
    | "require_validation_after_task_completion"
    | "manual_resolution_only";
  resolution_source?: string;
  occurred_at: Date;
  first_action_at?: Date;
  last_task_version_synced?: number;
}

export type SyncEffect =
  | {
      kind: "noop";
      reason:
        | "stale_version"
        | "occurrence_not_current"
        | "manual_resolution_wins"
        | "not_required"
        | "no_status_change";
    }
  | {
      kind: "update_status";
      resolution_status: Extract<
        AnalyticsResolutionStatus,
        "open" | "in_progress" | "waiting" | "blocked"
      >;
      set_first_action_at?: Date;
    }
  | {
      kind: "resolve";
      resolved_at: Date;
      resolved_by?: string;
      resolution_source: "task_completion";
      resolution_time_minutes: number;
      time_to_first_action_minutes?: number;
    }
  | { kind: "pending_validation" }
  | { kind: "task_cancelled"; resolution_status: "open" };

const OPENISH: readonly AnalyticsResolutionStatus[] = [
  "open",
  "in_progress",
  "waiting",
  "blocked",
  "pending_validation",
];

export function decideOccurrenceEffect(
  occurrence: OccurrenceSyncView,
  task: TaskView
): SyncEffect {
  if (
    occurrence.last_task_version_synced !== undefined &&
    task.version <= occurrence.last_task_version_synced
  ) {
    return { kind: "noop", reason: "stale_version" };
  }

  if (!occurrence.is_current || occurrence.record_status !== "valid") {
    return { kind: "noop", reason: "occurrence_not_current" };
  }

  if (occurrence.resolution_status === "not_required") {
    return { kind: "noop", reason: "not_required" };
  }

  if (
    occurrence.resolution_status === "resolved" &&
    occurrence.resolution_source === "manual_resolution"
  ) {
    return { kind: "noop", reason: "manual_resolution_wins" };
  }

  switch (task.lifecycle_state) {
    case "open":
      return occurrence.resolution_status === "open"
        ? { kind: "noop", reason: "no_status_change" }
        : transitionIfOpenish(occurrence, "open");

    case "in_progress":
      return transitionIfOpenish(occurrence, "in_progress", true);

    case "waiting":
      return transitionIfOpenish(occurrence, "waiting", true);

    case "blocked":
      return transitionIfOpenish(occurrence, "blocked", true);

    case "cancelled":
      if (occurrence.resolution_status === "resolved") {
        return { kind: "noop", reason: "no_status_change" };
      }
      return OPENISH.includes(occurrence.resolution_status)
        ? { kind: "task_cancelled", resolution_status: "open" }
        : { kind: "noop", reason: "no_status_change" };

    case "completed":
      return handleCompleted(occurrence, task);
  }
}

function transitionIfOpenish(
  occurrence: OccurrenceSyncView,
  to: "open" | "in_progress" | "waiting" | "blocked",
  countsAsFirstAction = false
): SyncEffect {
  if (!OPENISH.includes(occurrence.resolution_status)) {
    return { kind: "noop", reason: "no_status_change" };
  }
  if (occurrence.resolution_status === to) {
    return { kind: "noop", reason: "no_status_change" };
  }

  return {
    kind: "update_status",
    resolution_status: to,
    set_first_action_at:
      countsAsFirstAction && !occurrence.first_action_at
        ? new Date()
        : undefined,
  };
}

function handleCompleted(
  occurrence: OccurrenceSyncView,
  task: TaskView
): SyncEffect {
  if (task.completion_result !== "resolved") {
    return OPENISH.includes(occurrence.resolution_status) &&
      occurrence.resolution_status !== "open"
      ? { kind: "update_status", resolution_status: "open" }
      : { kind: "noop", reason: "no_status_change" };
  }

  switch (occurrence.resolution_behavior) {
    case "auto_resolve_on_task_completion": {
      if (occurrence.resolution_status === "resolved") {
        return { kind: "noop", reason: "no_status_change" };
      }

      const resolvedAt = task.completed_at ?? new Date();
      return {
        kind: "resolve",
        resolved_at: resolvedAt,
        resolved_by: task.completed_by,
        resolution_source: "task_completion",
        resolution_time_minutes: diffMinutes(
          resolvedAt,
          occurrence.occurred_at
        ),
        time_to_first_action_minutes: occurrence.first_action_at
          ? diffMinutes(occurrence.first_action_at, occurrence.occurred_at)
          : undefined,
      };
    }

    case "require_validation_after_task_completion":
      return occurrence.resolution_status === "pending_validation" ||
        occurrence.resolution_status === "resolved"
        ? { kind: "noop", reason: "no_status_change" }
        : { kind: "pending_validation" };

    case "manual_resolution_only":
    case "none":
      return { kind: "noop", reason: "no_status_change" };
  }
}

export function diffMinutes(later: Date, earlier: Date) {
  return Math.max(
    0,
    Math.round((later.getTime() - earlier.getTime()) / 60000)
  );
}

export class ResolutionFlowError extends Error {
  constructor(
    message: string,
    public readonly code: "wrong_status" | "not_current" | "factory_required"
  ) {
    super(message);
    this.name = "ResolutionFlowError";
  }
}

export interface ValidationApproval {
  approved_at: Date;
  approved_by: string;
}

export function decideValidationApproval(
  occurrence: OccurrenceSyncView,
  approval: ValidationApproval
): {
  resolution_status: "resolved";
  resolved_at: Date;
  resolved_by: string;
  resolution_source: "validation";
  resolution_time_minutes: number;
} {
  if (!occurrence.is_current || occurrence.record_status !== "valid") {
    throw new ResolutionFlowError(
      "Ocorrencia nao e o registro atual.",
      "not_current"
    );
  }
  if (occurrence.resolution_status !== "pending_validation") {
    throw new ResolutionFlowError(
      `Validacao so se aplica a pending_validation (atual: ${occurrence.resolution_status}).`,
      "wrong_status"
    );
  }

  return {
    resolution_status: "resolved",
    resolved_at: approval.approved_at,
    resolved_by: approval.approved_by,
    resolution_source: "validation",
    resolution_time_minutes: diffMinutes(
      approval.approved_at,
      occurrence.occurred_at
    ),
  };
}

export type RejectionNextAction =
  | "create_follow_up_task"
  | "return_to_responsible"
  | "keep_open_without_task";

export function decideValidationRejection(
  occurrence: OccurrenceSyncView
): {
  resolution_status: "open";
  clear_resolution_fields: true;
} {
  if (!occurrence.is_current || occurrence.record_status !== "valid") {
    throw new ResolutionFlowError(
      "Ocorrencia nao e o registro atual.",
      "not_current"
    );
  }
  if (occurrence.resolution_status !== "pending_validation") {
    throw new ResolutionFlowError(
      `Rejeicao so se aplica a pending_validation (atual: ${occurrence.resolution_status}).`,
      "wrong_status"
    );
  }

  return { resolution_status: "open", clear_resolution_fields: true };
}

export function resolveCompletionResult(
  input: TaskCompletionResult | undefined,
  hasLinkedOccurrence: boolean
): TaskCompletionResult {
  if (input) return input;
  if (hasLinkedOccurrence) {
    throw new ResolutionFlowError(
      "completion_result e obrigatorio ao concluir tarefa vinculada a ocorrencia.",
      "wrong_status"
    );
  }
  return "resolved";
}

export function isTaskLifecycleState(
  value: unknown
): value is TaskLifecycleState {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  );
}

export function isTaskCompletionResult(
  value: unknown
): value is TaskCompletionResult {
  return (
    value === "resolved" ||
    value === "not_resolved" ||
    value === "partially_resolved" ||
    value === "cancelled" ||
    value === "duplicate" ||
    value === "not_applicable"
  );
}
