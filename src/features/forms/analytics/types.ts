import type { Timestamp } from "firebase-admin/firestore";

export type TaxonomySource = "system_seed" | "user_created";

export type AnalyticsSeverity = "low" | "medium" | "high" | "critical";

export type AnalyticsResultPolarity =
  | "positive"
  | "negative"
  | "neutral"
  | "corrective";

export type AnalyticsTargetType =
  | "asset"
  | "collaborator"
  | "unit"
  | "location"
  | "product"
  | "process"
  | "free_target";

export type AnalyticsFreeTargetType =
  | "location"
  | "free_target"
  | "process"
  | "unit_area";

export type AnalyticsTargetScope = "workspace" | "unit" | "multi_unit";

export interface AnalyticsTaxonomyGovernance {
  source: TaxonomySource;
  is_editable: boolean;
  is_deletable: boolean;
  is_active: boolean;
}

export interface AnalyticsAuditFields {
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string;
  updated_by?: string;
}

export interface FormAnalyticsDomain
  extends AnalyticsTaxonomyGovernance,
    AnalyticsAuditFields {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  icon?: string;
  order: number;
}

export interface FormAnalyticsCriterion
  extends AnalyticsTaxonomyGovernance,
    AnalyticsAuditFields {
  id: string;
  workspace_id: string;
  domain_id: string;
  name: string;
  slug: string;
  description?: string;
  default_severity?: AnalyticsSeverity;
  default_result_positive_id?: string;
  default_result_negative_id?: string;
  target_type?: AnalyticsTargetType;
  order: number;
}

export interface FormAnalyticsResult
  extends AnalyticsTaxonomyGovernance,
    AnalyticsAuditFields {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  polarity: AnalyticsResultPolarity;
  severity?: AnalyticsSeverity;
  counts_as_evaluation: boolean;
  counts_as_occurrence: boolean;
  counts_as_non_conformity: boolean;
  is_closing_result?: boolean;
  color?: string;
  order: number;
}

export interface FormAnalyticsTarget
  extends AnalyticsTaxonomyGovernance,
    AnalyticsAuditFields {
  id: string;
  workspace_id: string;
  type: AnalyticsFreeTargetType;
  target_scope: AnalyticsTargetScope;
  name: string;
  code?: string;
  description?: string;
  unit_ids?: string[];
  parent_id?: string;
  group_id?: string;
  metadata?: Record<string, unknown>;
}

export const ANALYTICS_COLLECTIONS = {
  domains: "form_analytics_domains",
  criteria: "form_analytics_criteria",
  results: "form_analytics_results",
  targets: "form_analytics_targets",
  occurrences: "form_occurrences",
} as const;

export type AnalyticsCollectionName =
  (typeof ANALYTICS_COLLECTIONS)[keyof typeof ANALYTICS_COLLECTIONS];
