import { z } from "zod";

import {
  analyticsSeveritySchema,
  analyticsTargetScopeSchema,
  analyticsTargetTypeSchema,
} from "./schemas";

const idRef = z.string().trim().min(1).max(200);

export const formItemOptionAnalyticsSchema = z
  .object({
    criterion_id: idRef.optional(),
    target_id: idRef.optional(),
    target_name: z.string().trim().max(120).optional(),
    result_id: idRef.optional(),
    severity: analyticsSeveritySchema.optional(),
  })
  .strict();

export const formItemOptionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_-]+$/i, "id de opção inválido"),
    label: z.string().trim().min(1).max(200),
    value: z.string().max(200).optional(),
    analytics: formItemOptionAnalyticsSchema.optional(),
    is_active: z.boolean().optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

export type FormItemOption = z.infer<typeof formItemOptionSchema>;

export const occurrenceConditionSchema = z
  .object({
    operator: z.enum([
      "always",
      "equals",
      "not_equals",
      "contains",
      "out_of_range",
      "is_empty",
      "is_not_empty",
    ]),
    value: z.unknown().optional(),
  })
  .strict();

export const cascadeEvaluationsSchema = z
  .object({
    enabled: z.boolean(),
    trigger: z
      .object({
        operator: z.enum(["equals", "not_equals"]),
        value: z.unknown(),
      })
      .strict(),
    expands_from_item_id: idRef,
    expansion_source: z.literal("child_item_options"),
    expansion_mode: z.literal("generate_positive_evaluations_for_all_options"),
    result_id: idRef,
    denominator_scope: z.literal("absolute"),
    require_mutual_exclusion_with_child_visibility: z.literal(true),
  })
  .strict();

export type CascadeEvaluationsConfig = z.infer<
  typeof cascadeEvaluationsSchema
>;

export const formItemAnalyticsConfigSchema = z
  .object({
    enabled: z.boolean(),
    domain_id: idRef.optional(),
    criterion_id: idRef.optional(),
    target_type: analyticsTargetTypeSchema.optional(),
    target_source: z
      .enum([
        "fixed",
        "execution_unit",
        "answered_item",
        "assigned_collaborator",
        "executor",
        "selected_option",
        "manual",
      ])
      .optional(),
    fixed_target_id: idRef.optional(),
    fixed_target_name: z.string().trim().max(200).optional(),
    target_item_id: idRef.optional(),
    target_scope: analyticsTargetScopeSchema.optional(),
    occurrence_mode: z
      .enum(["single", "per_selected_option", "per_target"])
      .default("single"),
    occurrence_condition: occurrenceConditionSchema.default({
      operator: "always",
    }),
    evaluation_mode: z
      .enum(["negative_only", "positive_and_negative", "all_options_when_visible"])
      .default("negative_only"),
    positive_result_id: idRef.optional(),
    negative_result_id: idRef.optional(),
    neutral_result_id: idRef.optional(),
    severity: analyticsSeveritySchema.optional(),
    requires_description: z.boolean().optional(),
    description_item_id: idRef.optional(),
    description_mapping_mode: z
      .enum(["shared_text", "prefix_parser", "per_option_detail"])
      .optional(),
    evidence_item_ids: z.array(idRef).max(20).optional(),
    create_task: z.boolean().optional(),
    task_trigger_id: idRef.optional(),
    sla_hours: z.number().int().min(1).max(24 * 365).optional(),
    resolution_behavior: z
      .enum([
        "none",
        "auto_resolve_on_task_completion",
        "require_validation_after_task_completion",
        "manual_resolution_only",
      ])
      .default("none"),
    cascade_evaluations: cascadeEvaluationsSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict();

export type FormItemAnalyticsConfig = z.infer<
  typeof formItemAnalyticsConfigSchema
>;

export const showIfConditionSchema = z
  .object({
    item_id: idRef,
    operator: z.enum(["equals", "not_equals"]),
    value: z.unknown(),
  })
  .strict();

export type ShowIfCondition = z.infer<typeof showIfConditionSchema>;

export const analyticsItemViewSchema = z
  .object({
    id: idRef,
    type: z.enum([
      "yes_no",
      "checkbox",
      "number",
      "temperature",
      "select",
      "multi_select",
      "text",
      "photo",
      "signature",
      "date",
      "file_upload",
      "location",
    ]),
    title: z.string(),
    options: z.array(formItemOptionSchema).optional(),
    show_if: showIfConditionSchema.optional(),
    analytics_config: formItemAnalyticsConfigSchema.optional(),
  })
  .strict();

export type AnalyticsItemView = z.infer<typeof analyticsItemViewSchema>;
