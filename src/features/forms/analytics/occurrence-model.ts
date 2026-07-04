import { createHash } from "node:crypto";

import type { Timestamp } from "firebase-admin/firestore";

import type {
  AnalyticsResultPolarity,
  AnalyticsSeverity,
  AnalyticsTargetScope,
  AnalyticsTargetType,
} from "./types";

export type AnalyticsRecordType = "evaluation" | "occurrence";
export type AnalyticsRecordStatus = "valid" | "superseded" | "cancelled";
export type AnalyticsRecordStatusReason =
  | "execution_reopened"
  | "execution_cancelled"
  | "reprocess"
  | "manual_adjustment";
export type AnalyticsResolutionStatus =
  | "not_required"
  | "open"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "pending_validation"
  | "resolved"
  | "cancelled";
export type AnalyticsGeneratedBy =
  | "direct_item"
  | "cascade_from_parent"
  | "manual_adjustment"
  | "reprocess";
export type AnalyticsCreatedFrom =
  | "form_execution"
  | "manual_adjustment"
  | "reprocess"
  | "migration";
export type AnalyticsDenominatorScope = "absolute" | "conditional";

export interface AnalyticsEvidenceRef {
  type: "photo" | "file" | "signature" | "location" | "note";
  item_id: string;
  ref: string;
}

export interface OccurrenceDraft {
  workspace_id: string;
  form_project_id?: string;
  template_id: string;
  template_version: number;
  execution_id: string;
  execution_completed_at: Date;
  section_id?: string;
  section_title_snapshot?: string;
  template_item_id: string;
  execution_item_id?: string;
  item_title_snapshot: string;
  answer_value?: unknown;
  answer_label?: string;
  option_id?: string;
  option_label_snapshot?: string;
  generated_by: AnalyticsGeneratedBy;
  expanded_from_item_id?: string;
  expanded_from_child_item_id?: string;
  record_type: AnalyticsRecordType;
  domain_id: string;
  domain_name_snapshot: string;
  criterion_id?: string;
  criterion_name_snapshot?: string;
  result_id: string;
  result_name_snapshot: string;
  result_polarity: AnalyticsResultPolarity;
  counts_as_evaluation: boolean;
  counts_as_occurrence: boolean;
  counts_as_non_conformity: boolean;
  denominator_scope: AnalyticsDenominatorScope;
  severity?: AnalyticsSeverity;
  target_type: AnalyticsTargetType;
  target_id?: string;
  target_name_snapshot: string;
  target_code_snapshot?: string;
  target_scope?: AnalyticsTargetScope;
  target_identity_key: string;
  unit_id?: string;
  unit_name_snapshot?: string;
  asset_id?: string;
  target_brand?: string;
  target_model?: string;
  target_category?: string;
  target_asset_code?: string;
  collaborator_id?: string;
  collaborator_name_snapshot?: string;
  collaborator_role_snapshot?: string;
  target_metadata_snapshot?: Record<string, unknown>;
  description?: string;
  description_source_item_id?: string;
  description_extraction?: "shared_text" | "parsed_by_prefix" | "per_option_detail";
  description_confidence?: "high" | "medium" | "low";
  evidence_refs?: AnalyticsEvidenceRef[];
  occurred_at: Date;
  due_at?: Date;
  bucket_timezone: string;
  occurred_local_date: string;
  occurred_year_month: string;
  record_status: AnalyticsRecordStatus;
  is_current: boolean;
  resolution_status: AnalyticsResolutionStatus;
  resolution_behavior:
    | "none"
    | "auto_resolve_on_task_completion"
    | "require_validation_after_task_completion"
    | "manual_resolution_only";
  create_task?: boolean;
  task_trigger_id?: string;
  has_active_task: boolean;
  contains_personal_data: boolean;
  personal_data_subject_type?: "collaborator";
  occurrence_identity_key: string;
  dedupe_key: string;
  analytics_revision: number;
  generation_batch_id: string;
  created_from: AnalyticsCreatedFrom;
}

export function buildTargetIdentityKey(params: {
  workspace_id: string;
  target_type: AnalyticsTargetType;
  target_id?: string;
  unit_id?: string;
}) {
  return [
    params.workspace_id,
    params.target_type,
    params.target_id ?? "no_target_id",
    params.unit_id ?? "global",
  ].join(":");
}

export function buildOccurrenceIdentityKey(params: {
  workspace_id: string;
  execution_id: string;
  template_item_id: string;
  record_type: AnalyticsRecordType;
  domain_id: string;
  criterion_id?: string;
  target_type: AnalyticsTargetType;
  target_identity_key: string;
  option_id?: string;
}) {
  return [
    params.workspace_id,
    params.execution_id,
    params.template_item_id,
    params.record_type,
    params.domain_id,
    params.criterion_id ?? "no_criterion",
    params.target_type,
    params.target_identity_key,
    params.option_id ?? "no_option",
  ].join(":");
}

export function buildDedupeKey(identityKey: string, analyticsRevision: number) {
  return `${identityKey}:rev:${analyticsRevision}`;
}

export function dedupeDocId(dedupeKey: string) {
  return `occ_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 40)}`;
}

export function localDateParts(utc: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const occurredLocalDate = formatter.format(utc);
  return {
    occurred_local_date: occurredLocalDate,
    occurred_year_month: occurredLocalDate.slice(0, 7),
  };
}

export interface AnalyticsRecordStatusPatch {
  record_status: AnalyticsRecordStatus;
  is_current: boolean;
  record_status_reason?: AnalyticsRecordStatusReason;
  record_status_changed_at: Date;
  superseded_by_generation_batch_id?: string;
}

export function buildRecordStatusPatch(
  status: AnalyticsRecordStatus,
  reason?: AnalyticsRecordStatusReason,
  supersededByBatchId?: string
): AnalyticsRecordStatusPatch {
  return {
    record_status: status,
    is_current: status === "valid",
    ...(reason ? { record_status_reason: reason } : {}),
    record_status_changed_at: new Date(),
    ...(supersededByBatchId
      ? { superseded_by_generation_batch_id: supersededByBatchId }
      : {}),
  };
}

export type FirestoreOccurrenceDraft = Omit<
  OccurrenceDraft,
  "execution_completed_at" | "occurred_at"
> & {
  execution_completed_at: Timestamp;
  occurred_at: Timestamp;
};
