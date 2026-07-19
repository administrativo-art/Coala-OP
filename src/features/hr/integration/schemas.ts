import { z } from "zod";

import { DEFAULT_PROBATION_CONFIG } from "./probation";

export const INTEGRATION_TEMPLATE_SCHEMA_VERSION = "coala-integration-v1" as const;

const idSchema = z.string().trim().min(1).max(120);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const integrationConditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
  "file_uploaded",
  "file_approved",
  "date_before",
  "date_after",
]);

const integrationPredicateSchema = z.object({
  kind: z.literal("predicate"),
  source: z.enum(["answer", "variable", "context", "stage", "upload", "evaluation"]),
  key: idSchema,
  operator: integrationConditionOperatorSchema,
  value: z.unknown().optional(),
});

export type IntegrationCondition =
  | z.infer<typeof integrationPredicateSchema>
  | {
      kind: "group";
      operator: "and" | "or" | "not";
      conditions: IntegrationCondition[];
    };

export const integrationConditionSchema: z.ZodType<IntegrationCondition> = z.lazy(() =>
  z.union([
    integrationPredicateSchema,
    z.object({
      kind: z.literal("group"),
      operator: z.enum(["and", "or", "not"]),
      conditions: z.array(integrationConditionSchema).min(1),
    }).superRefine((group, ctx) => {
      if (group.operator === "not" && group.conditions.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "O grupo NÃO deve possuir exatamente uma condição.",
          path: ["conditions"],
        });
      }
    }),
  ]),
);

export const integrationAssigneeSchema = z.object({
  strategy: z.enum([
    "specific_user",
    "profile",
    "job_role",
    "job_function",
    "direct_manager",
    "unit_manager",
    "hr_pool",
    "employee",
    "candidate",
    "selected_during_execution",
  ]),
  referenceId: z.string().trim().max(160).optional(),
  fallback: z.enum(["unit_manager", "hr_pool"]).optional(),
});

export const integrationBlockTypeSchema = z.enum([
  "heading",
  "rich_text",
  "notice",
  "divider",
  "link",
  "image",
  "video",
  "text",
  "textarea",
  "number",
  "currency",
  "percentage",
  "date",
  "time",
  "datetime",
  "cpf",
  "cnpj",
  "pis",
  "phone",
  "email",
  "address",
  "yes_no",
  "single_select",
  "multi_select",
  "confirmation",
  "numeric_scale",
  "signature",
  "reference",
  "repeatable_group",
  "repeatable_table",
  "subform",
  "computed",
  "read_only",
  "upload",
  "task",
  "approval",
  "evaluation",
  "decision",
  "date_gate",
  "document_generation",
  "document_signature",
  "notification",
  "profile_update",
  "probation",
  "stage_completion",
]);

export const integrationOptionSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(240),
  value: z.union([z.string(), z.number(), z.boolean()]),
  active: z.boolean().default(true),
});

export const integrationValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().max(500).optional(),
  message: z.string().trim().max(500).optional(),
});

export const integrationSubfieldTypeSchema = z.enum([
  "text",
  "textarea",
  "number",
  "currency",
  "percentage",
  "date",
  "time",
  "datetime",
  "cpf",
  "cnpj",
  "pis",
  "phone",
  "email",
  "address",
  "yes_no",
  "single_select",
  "multi_select",
  "confirmation",
  "signature",
  "upload",
  "subform",
  "repeatable_group",
  "repeatable_table",
]);

export type IntegrationSubfield = {
  id: string;
  type: z.infer<typeof integrationSubfieldTypeSchema>;
  label: string;
  description?: string;
  helpText?: string;
  placeholder?: string;
  required: boolean;
  readOnly: boolean;
  options?: z.infer<typeof integrationOptionSchema>[];
  validation?: z.infer<typeof integrationValidationSchema>;
  config: Record<string, unknown>;
  fields?: IntegrationSubfield[];
};

export const integrationSubfieldSchema: z.ZodType<IntegrationSubfield, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: idSchema,
  type: integrationSubfieldTypeSchema,
  label: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
  helpText: z.string().trim().max(1000).optional(),
  placeholder: z.string().trim().max(300).optional(),
  required: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  options: z.array(integrationOptionSchema).max(500).optional(),
  validation: integrationValidationSchema.optional(),
  config: z.record(z.unknown()).default({}),
  fields: z.array(integrationSubfieldSchema).max(500).optional(),
}));

export const integrationBlockSchema = z.object({
  id: idSchema,
  stageId: idSchema,
  order: z.number().int().nonnegative(),
  type: integrationBlockTypeSchema,
  label: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
  helpText: z.string().trim().max(1000).optional(),
  placeholder: z.string().trim().max(300).optional(),
  required: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  active: z.boolean().default(true),
  variableKey: z.string().trim().max(180).optional(),
  writePolicy: z.enum(["process_only", "direct", "confirm", "approval"]).default("process_only"),
  hiddenAnswerPolicy: z.enum(["exclude", "clear"]).default("exclude"),
  options: z.array(integrationOptionSchema).max(500).optional(),
  validation: integrationValidationSchema.optional(),
  visibilityCondition: integrationConditionSchema.optional(),
  requiredCondition: integrationConditionSchema.optional(),
  assignee: integrationAssigneeSchema.optional(),
  fields: z.array(integrationSubfieldSchema).max(500).optional(),
  config: z.record(z.unknown()).default({}),
});

export const integrationStageSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  order: z.number().int().nonnegative(),
  required: z.boolean().default(true),
  skippable: z.boolean().default(false),
  dueDays: z.number().int().nonnegative().nullable().default(null),
  dueDateSource: z.enum(["stage_entry", "admission", "custom_variable"]).default("stage_entry"),
  dueDateVariableKey: z.string().trim().max(180).optional(),
  entryCondition: integrationConditionSchema.optional(),
  completionCondition: integrationConditionSchema.optional(),
  assignee: integrationAssigneeSchema.optional(),
});

export const integrationRuleActionSchema = z.object({
  id: idSchema,
  type: z.enum([
    "show_block",
    "hide_block",
    "require_block",
    "filter_options",
    "skip_stage",
    "activate_stage",
    "assign_responsible",
    "set_value",
    "create_task",
    "require_upload",
    "generate_document",
    "request_signature",
    "notify",
    "block_progress",
    "complete_integration",
  ]),
  targetId: z.string().trim().max(180).optional(),
  config: z.record(z.unknown()).default({}),
});

export const integrationRuleSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(240),
  active: z.boolean().default(true),
  priority: z.number().int().default(0),
  condition: integrationConditionSchema,
  actions: z.array(integrationRuleActionSchema).min(1).max(100),
});

export const integrationCommunicationEventSchema = z.enum([
  "formalization_started",
  "first_access",
]);

export const integrationCommunicationSchema = z.object({
  event: integrationCommunicationEventSchema,
  enabled: z.boolean().default(true),
  subject: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(240),
  message: z.string().trim().min(1).max(6000),
  buttonLabel: z.string().trim().min(1).max(120),
});

export const DEFAULT_INTEGRATION_COMMUNICATIONS = [
  {
    event: "formalization_started" as const,
    enabled: true,
    subject: "Bem-vindo(a) à Coala Shakes — complete sua formalização",
    title: "Bem-vindo(a) à Coala Shakes!",
    message:
      "Olá, {{employee.name}}!\n\nEstamos iniciando sua formalização para o cargo de {{system.role.job_role}}, na função {{system.role.functions}}. Para continuar, preencha o formulário e envie as informações e documentos solicitados.\n\nEste link é individual e ficará disponível até {{integration.formalization_deadline}}. Não compartilhe este e-mail.",
    buttonLabel: "Iniciar minha formalização",
  },
  {
    event: "first_access" as const,
    enabled: true,
    subject: "Seu acesso ao Coala One está pronto — cadastre sua senha",
    title: "Seu acesso ao Coala One está pronto",
    message:
      "Olá, {{employee.name}}!\n\nSua formalização foi concluída com sucesso e seu cadastro no Coala One já está disponível. Para acessar o sistema pela primeira vez, cadastre uma senha pessoal.\n\nO link é individual e temporário. Se ele estiver vencido, solicite um novo acesso ao RH. Seja bem-vindo(a) ao time Coala Shakes!",
    buttonLabel: "Cadastrar minha senha",
  },
] as const;

export const probationConfigSchema = z.object({
  firstPeriodDays: z.number().int().min(1).max(90).default(DEFAULT_PROBATION_CONFIG.firstPeriodDays),
  secondPeriodDays: z.number().int().min(0).max(89).default(DEFAULT_PROBATION_CONFIG.secondPeriodDays),
  evaluationWindowDays: z.number().int().min(1).max(90).default(DEFAULT_PROBATION_CONFIG.evaluationWindowDays),
  alertsBeforeDays: z.array(z.number().int().min(0).max(90)).max(20).default([10, 5, 1]),
  extensionTermRequired: z.boolean().default(false),
  extensionDocumentTemplateId: z.string().trim().max(180).optional(),
  evaluator: integrationAssigneeSchema.default({ strategy: "direct_manager", fallback: "hr_pool" }),
  effectivenessRule: z.enum(["manual", "approved_evaluations", "automatic_at_end"]).default("manual"),
  evaluationFormId: z.string().trim().max(180).optional(),
}).superRefine((value, ctx) => {
  if (value.firstPeriodDays + value.secondPeriodDays > 90) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A soma dos períodos não pode ultrapassar 90 dias." });
  }
  if (value.evaluationWindowDays > value.firstPeriodDays) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A janela não pode ser maior que o primeiro período.", path: ["evaluationWindowDays"] });
  }
  if (value.secondPeriodDays > 0 && value.evaluationWindowDays > value.secondPeriodDays) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A janela não pode ser maior que o segundo período.", path: ["evaluationWindowDays"] });
  }
});

export const integrationTemplateContentSchema = z.object({
  stages: z.array(integrationStageSchema).min(1).max(500),
  blocks: z.array(integrationBlockSchema).max(2000).default([]),
  rules: z.array(integrationRuleSchema).max(2000).default([]),
  communications: z.array(integrationCommunicationSchema).max(2).default(() =>
    DEFAULT_INTEGRATION_COMMUNICATIONS.map((item) => ({ ...item }))
  ),
  probation: probationConfigSchema.optional(),
  completionRules: z.array(integrationConditionSchema).max(200).default([]),
});

export const integrationTemplateVersionSchema = z.object({
  schemaVersion: z.literal(INTEGRATION_TEMPLATE_SCHEMA_VERSION).default(INTEGRATION_TEMPLATE_SCHEMA_VERSION),
  templateId: idSchema,
  version: z.number().int().positive(),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).optional(),
  roleId: idSchema,
  functionId: idSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  createdBy: idSchema,
  publishedAt: z.string().datetime().nullable().default(null),
}).merge(integrationTemplateContentSchema);

export const integrationTemplateCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).optional(),
  roleId: idSchema,
  functionId: idSchema.nullable().optional(),
  isDefault: z.boolean().default(false),
  cloneFromTemplateId: idSchema.optional(),
  cloneFromVersion: z.number().int().positive().optional(),
});

export const integrationTemplateUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  isDefault: z.boolean().optional(),
  content: integrationTemplateContentSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Informe ao menos uma alteração.",
});

export const integrationProcessCreateSchema = z.object({
  mode: z.enum(["import", "blank"]),
  candidateId: idSchema.optional(),
  candidateName: z.string().trim().min(2).max(200),
  candidateEmail: z.string().trim().email(),
  roleId: idSchema,
  functionId: idSchema.nullable().optional(),
  expectedAdmissionDate: dateOnlySchema.nullable().optional(),
  templateId: idSchema.optional(),
  templateVersion: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "import" && !value.templateId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Selecione um modelo para importar.", path: ["templateId"] });
  }
  if (value.mode === "blank" && (value.templateId || value.templateVersion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Uma integração nova não pode sobrescrever ou importar um modelo.", path: ["templateId"] });
  }
});

export type IntegrationTemplateVersion = z.infer<typeof integrationTemplateVersionSchema>;
export type IntegrationBlock = z.infer<typeof integrationBlockSchema>;
export type IntegrationStage = z.infer<typeof integrationStageSchema>;
export type IntegrationRule = z.infer<typeof integrationRuleSchema>;
export type IntegrationCommunication = z.infer<typeof integrationCommunicationSchema>;
export type IntegrationCommunicationEvent = z.infer<typeof integrationCommunicationEventSchema>;
