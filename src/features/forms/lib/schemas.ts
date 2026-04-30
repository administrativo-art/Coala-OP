import { z } from "zod";

const isoDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

export const formConditionalOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "is_empty",
  "is_not_empty",
]);

export const formConditionalRuleSchema = z.object({
  item_id: z.string().trim().min(1),
  operator: formConditionalOperatorSchema,
  value: z.unknown().optional(),
});

export const formItemConfigSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().trim().max(20).optional(),
  alert_out_of_range: z.boolean().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  min_photos: z.number().int().min(1).optional(),
  max_photos: z.number().int().min(1).optional(),
  allow_multiple: z.boolean().optional(),
  accept: z.string().trim().max(200).optional(),
});

export const formTaskTriggerSchema = z.object({
  id: z.string().trim().min(1),
  title_template: z.string().trim().min(1),
  description_template: z.string().trim().max(2000).optional(),
  task_project_id: z.string().trim().min(1),
  assignee_type: z.enum(["user", "role"]),
  assignee_id: z.string().trim().min(1),
  assignee_name: z.string().trim().max(200).optional(),
  requires_approval: z.boolean().default(false),
  approver_id: z.string().trim().min(1).optional(),
  approver_name: z.string().trim().max(200).optional(),
  sla_hours: z.number().int().min(1).optional(),
  condition: formConditionalRuleSchema.optional(),
});

export const formTemplateItemSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1),
    order: z.number().int().min(0),
    title: z.string().trim().min(2),
    description: z.string().trim().max(500).optional(),
    type: z.enum([
      "checkbox",
      "text",
      "number",
      "temperature",
      "select",
      "photo",
      "signature",
      "yes_no",
      "multi_select",
      "date",
      "file_upload",
      "location",
    ]),
    required: z.boolean().default(true),
    weight: z.number().int().min(0).max(10).default(1),
    block_next: z.boolean().default(false),
    criticality: z.enum(["low", "medium", "high", "critical"]).default("low"),
    reference_value: z.number().optional(),
    tolerance_percent: z.number().min(0).max(100).optional(),
    action_required: z.boolean().optional(),
    notify_role_ids: z.array(z.string().trim().min(1)).optional(),
    escalation_minutes: z.number().int().min(1).optional(),
    show_if: formConditionalRuleSchema.optional(),
    conditional_branches: z
      .array(
        z.object({
          value: z.unknown().optional(),
          label: z.string().trim().min(1),
          items: z.array(formTemplateItemSchema),
        })
      )
      .optional(),
    task_triggers: z.array(formTaskTriggerSchema).optional(),
    config: formItemConfigSchema.optional(),
  })
);

export const formTemplateSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  order: z.number().int().min(0),
  show_if: formConditionalRuleSchema.optional(),
  require_photo: z.boolean().optional(),
  require_signature: z.boolean().optional(),
  items: z.array(formTemplateItemSchema).min(1),
});

export const formProjectSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(40).optional(),
  icon: z.string().trim().max(100).optional(),
  is_active: z.boolean().default(true),
  members: z
    .array(
      z.object({
        user_id: z.string().trim().min(1),
        username: z.string().trim().min(1),
        role: z.enum(["viewer", "operator", "manager"]),
        custom_permissions: z
          .object({
            view: z.boolean().optional(),
            operate: z.boolean().optional(),
            manage: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .default([]),
});

export const formTypeSchema = z.object({
  form_project_id: z.string().trim().min(1),
  name: z.string().trim().min(2),
  description: z.string().trim().max(2000).optional(),
  requires_subtype: z.boolean().default(false),
  context: z.enum(["operational", "recruitment"]).default("operational"),
  order: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

export const formSubtypeSchema = z.object({
  form_project_id: z.string().trim().min(1),
  form_type_id: z.string().trim().min(1),
  name: z.string().trim().min(2),
  description: z.string().trim().max(2000).optional(),
  order: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

export const formRecruitmentConfigSchema = z.object({
  requires_lgpd_consent: z.boolean(),
  public_landing: z.boolean(),
  candidate_dedupe_keys: z.array(z.enum(["cpf", "email"])).default([]),
  rate_limit_per_ip_per_day: z.number().int().min(1).optional(),
});

export const formTemplateSchema = z.object({
  form_project_id: z.string().trim().min(1),
  form_type_id: z.string().trim().min(1),
  form_subtype_id: z.string().trim().min(1).optional(),
  context: z.enum(["operational", "recruitment"]).default("operational"),
  name: z.string().trim().min(2),
  description: z.string().trim().max(2000).optional(),
  occurrence_type: z
    .enum(["manual", "daily", "weekly", "biweekly", "monthly", "annual", "custom"])
    .optional(),
  annual_schedule: z
    .object({
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
    })
    .optional(),
  custom_schedule: z
    .object({
      modes: z.array(z.enum(["weekdays", "monthdays", "interval", "once"])).default([]),
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      monthdays: z.array(z.number().int().min(1).max(31)).optional(),
      interval_days: z.number().int().min(1).optional(),
      once_dates: z.array(isoDateSchema).optional(),
    })
    .optional(),
  unit_ids: z.array(z.string().trim().min(1)).default([]),
  unit_names: z.array(z.string().trim().min(1)).optional(),
  job_role_ids: z.array(z.string().trim().min(1)).default([]),
  job_role_names: z.array(z.string().trim().min(1)).optional(),
  job_function_ids: z.array(z.string().trim().min(1)).default([]),
  job_function_names: z.array(z.string().trim().min(1)).optional(),
  shift_definition_ids: z.array(z.string().trim().min(1)).default([]),
  shift_definition_names: z.array(z.string().trim().min(1)).optional(),
  is_active: z.boolean().default(true),
  change_notes: z.string().trim().max(500).optional(),
  sections: z.array(formTemplateSectionSchema).min(1),
  recruitment_config: formRecruitmentConfigSchema.optional(),
});

export const formExecutionItemUpdateSchema = z.object({
  template_item_id: z.string().trim().min(1),
  section_id: z.string().trim().min(1),
  value: z.unknown().optional(),
  checked: z.boolean().nullable().optional(),
  yes_no_value: z.boolean().nullable().optional(),
  text_value: z.string().optional(),
  number_value: z.number().optional(),
  multi_values: z.array(z.string()).optional(),
  date_value: z.string().optional(),
  photo_urls: z.array(z.string()).optional(),
  file_urls: z
    .array(
      z.object({
        url: z.string().trim().min(1),
        name: z.string().trim().min(1),
        mime: z.string().trim().min(1),
      })
    )
    .optional(),
  signature_url: z.string().optional(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().optional(),
    })
    .optional(),
});

export const formExecutionUpdateSchema = z.object({
  action: z.enum(["save", "complete", "reopen", "cancel"]),
  items: z.array(formExecutionItemUpdateSchema).default([]),
});

export type FormProjectInput = z.infer<typeof formProjectSchema>;
export type FormTypeInput = z.infer<typeof formTypeSchema>;
export type FormSubtypeInput = z.infer<typeof formSubtypeSchema>;
export type FormTemplateInput = z.infer<typeof formTemplateSchema>;
export type FormExecutionUpdateInput = z.infer<typeof formExecutionUpdateSchema>;
