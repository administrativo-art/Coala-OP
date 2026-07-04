import type { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export const TASK_LIFECYCLE_STATES = [
  "open",
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "cancelled",
] as const;
export type TaskLifecycleState = (typeof TASK_LIFECYCLE_STATES)[number];

export const TASK_COMPLETION_RESULTS = [
  "resolved",
  "not_resolved",
  "partially_resolved",
  "cancelled",
  "duplicate",
  "not_applicable",
] as const;
export type TaskCompletionResult = (typeof TASK_COMPLETION_RESULTS)[number];

export const taskLifecycleStateSchema = z.enum(TASK_LIFECYCLE_STATES);
export const taskCompletionResultSchema = z.enum(TASK_COMPLETION_RESULTS);

export interface TaskStatusDefinition {
  id: string;
  workspace_id: string;
  name: string;
  color?: string;
  order: number;
  lifecycle_state: TaskLifecycleState;
  is_terminal: boolean;
  requires_completion_note?: boolean;
  requires_evidence?: boolean;
  is_system_default?: boolean;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

const terminalLifecycleStates: readonly TaskLifecycleState[] = [
  "completed",
  "cancelled",
];

export const createTaskStatusSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    color: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
    order: z.number().int().min(0).default(0),
    lifecycle_state: taskLifecycleStateSchema,
    is_terminal: z.boolean(),
    requires_completion_note: z.boolean().optional(),
    requires_evidence: z.boolean().optional(),
    is_active: z.boolean().default(true),
  })
  .strict()
  .superRefine((data, context) => {
    const isTerminalState = terminalLifecycleStates.includes(
      data.lifecycle_state
    );
    if (data.is_terminal !== isTerminalState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["is_terminal"],
        message:
          "is_terminal deve refletir lifecycle_state: completed/cancelled sao terminais; os demais nao.",
      });
    }
  });

export const updateTaskStatusSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    color: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
    order: z.number().int().min(0).optional(),
    requires_completion_note: z.boolean().optional(),
    requires_evidence: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export const SEED_TASK_STATUSES: readonly Omit<
  TaskStatusDefinition,
  "id" | "workspace_id" | "created_at" | "updated_at"
>[] = [
  {
    name: "Aberta",
    lifecycle_state: "open",
    is_terminal: false,
    order: 10,
    color: "#95A5A6",
    is_system_default: true,
    is_active: true,
  },
  {
    name: "Em execucao",
    lifecycle_state: "in_progress",
    is_terminal: false,
    order: 20,
    color: "#3498DB",
    is_system_default: true,
    is_active: true,
  },
  {
    name: "Aguardando",
    lifecycle_state: "waiting",
    is_terminal: false,
    order: 30,
    color: "#F39C12",
    is_system_default: true,
    is_active: true,
  },
  {
    name: "Bloqueada",
    lifecycle_state: "blocked",
    is_terminal: false,
    order: 40,
    color: "#E74C3C",
    is_system_default: true,
    is_active: true,
  },
  {
    name: "Concluida",
    lifecycle_state: "completed",
    is_terminal: true,
    order: 50,
    color: "#2ECC71",
    is_system_default: true,
    is_active: true,
    requires_completion_note: true,
  },
  {
    name: "Cancelada",
    lifecycle_state: "cancelled",
    is_terminal: true,
    order: 60,
    color: "#7F8C8D",
    is_system_default: true,
    is_active: true,
  },
];

export interface TaskView {
  id: string;
  workspace_id: string;
  lifecycle_state: TaskLifecycleState;
  status_id?: string;
  status_name_snapshot?: string;
  completion_result?: TaskCompletionResult;
  completed_at?: Date;
  completed_by?: string;
  cancelled_at?: Date;
  version: number;
}

export const LINK_TYPES = [
  "primary",
  "secondary",
  "follow_up",
  "validation",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_STATUSES = [
  "active",
  "inactive",
  "superseded",
  "orphaned",
  "cancelled",
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export type LinkDeactivationReason =
  | "task_cancelled"
  | "occurrence_superseded"
  | "occurrence_cancelled"
  | "validation_rejected"
  | "relinked_to_new_occurrence";

export interface FormOccurrenceTaskLink {
  id: string;
  workspace_id: string;
  occurrence_id: string;
  task_id: string;
  link_type: LinkType;
  link_status: LinkStatus;
  deactivation_reason?: LinkDeactivationReason;
  previous_link_id?: string;
  next_link_id?: string;
  last_synced_task_version?: number;
  is_active: boolean;
  created_at: Timestamp;
  created_by: string;
  deactivated_at?: Timestamp;
  deactivated_by?: string;
}

export const OCCURRENCE_TASK_LINKS_COLLECTION =
  "form_occurrence_task_links";
export const TASK_STATUS_DEFINITIONS_COLLECTION =
  "task_status_definitions";
