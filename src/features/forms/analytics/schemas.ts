import { z } from "zod";

export const analyticsSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const analyticsResultPolaritySchema = z.enum([
  "positive",
  "negative",
  "neutral",
  "corrective",
]);

export const analyticsTargetTypeSchema = z.enum([
  "asset",
  "collaborator",
  "unit",
  "location",
  "product",
  "process",
  "free_target",
]);

export const analyticsFreeTargetTypeSchema = z.enum([
  "location",
  "free_target",
  "process",
  "unit_area",
]);

export const analyticsTargetScopeSchema = z.enum([
  "workspace",
  "unit",
  "multi_unit",
]);

export const analyticsTaxonomySourceSchema = z.enum([
  "system_seed",
  "user_created",
]);

const nameSchema = z.string().trim().min(2, "Nome muito curto").max(120);
const descriptionSchema = z.string().trim().max(1000).optional();
const colorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{6})$/, "Cor deve ser hex #RRGGBB")
  .optional();
const orderSchema = z.number().int().min(0).default(0);
const idRefSchema = z.string().trim().min(1).max(200);
const slugSchema = z
  .string()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug inválido");

const governanceDocFields = {
  source: analyticsTaxonomySourceSchema,
  is_editable: z.boolean(),
  is_deletable: z.boolean(),
  is_active: z.boolean(),
};

export const createAnalyticsDomainSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    color: colorSchema,
    icon: z.string().trim().max(60).optional(),
    order: orderSchema,
    is_active: z.boolean().default(true),
  })
  .strict();

export const updateAnalyticsDomainSchema =
  createAnalyticsDomainSchema.partial().strict();

export const analyticsDomainDocSchema = createAnalyticsDomainSchema
  .extend({
    id: idRefSchema,
    workspace_id: idRefSchema,
    slug: slugSchema,
    ...governanceDocFields,
  })
  .strict();

export const createAnalyticsCriterionSchema = z
  .object({
    domain_id: idRefSchema,
    name: nameSchema,
    description: descriptionSchema,
    default_severity: analyticsSeveritySchema.optional(),
    default_result_positive_id: idRefSchema.optional(),
    default_result_negative_id: idRefSchema.optional(),
    target_type: analyticsTargetTypeSchema.optional(),
    order: orderSchema,
    is_active: z.boolean().default(true),
  })
  .strict();

export const updateAnalyticsCriterionSchema = createAnalyticsCriterionSchema
  .omit({ domain_id: true })
  .partial()
  .strict();

export const analyticsCriterionDocSchema = createAnalyticsCriterionSchema
  .extend({
    id: idRefSchema,
    workspace_id: idRefSchema,
    slug: slugSchema,
    ...governanceDocFields,
  })
  .strict();

const analyticsResultFlagsSchema = z.object({
  polarity: analyticsResultPolaritySchema,
  counts_as_evaluation: z.boolean(),
  counts_as_occurrence: z.boolean(),
  counts_as_non_conformity: z.boolean(),
  is_closing_result: z.boolean().optional(),
});

function refineAnalyticsResultFlags(
  data: z.infer<typeof analyticsResultFlagsSchema>,
  ctx: z.RefinementCtx
) {
  if (data.counts_as_non_conformity && !data.counts_as_evaluation) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["counts_as_evaluation"],
      message: "Nao conformidade deve contar como avaliacao.",
    });
  }

  if (data.counts_as_non_conformity && !data.counts_as_occurrence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["counts_as_occurrence"],
      message: "Nao conformidade deve contar como ocorrencia.",
    });
  }

  if (data.polarity === "positive" && data.counts_as_non_conformity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["counts_as_non_conformity"],
      message: "Resultado positivo nao pode contar como nao conformidade.",
    });
  }
}

export const createAnalyticsResultSchema = z
  .object({
    name: nameSchema,
    severity: analyticsSeveritySchema.optional(),
    color: colorSchema,
    order: orderSchema,
    is_active: z.boolean().default(true),
  })
  .merge(analyticsResultFlagsSchema)
  .strict()
  .superRefine(refineAnalyticsResultFlags);

export const updateAnalyticsResultSchema = z
  .object({
    name: nameSchema.optional(),
    severity: analyticsSeveritySchema.optional(),
    color: colorSchema,
    order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
    is_closing_result: z.boolean().optional(),
  })
  .strict();

export const analyticsResultDocSchema = z
  .object({
    id: idRefSchema,
    workspace_id: idRefSchema,
    name: nameSchema,
    slug: slugSchema,
    severity: analyticsSeveritySchema.optional(),
    color: colorSchema,
    order: z.number().int().min(0),
    ...governanceDocFields,
  })
  .merge(analyticsResultFlagsSchema)
  .strict()
  .superRefine(refineAnalyticsResultFlags);

const analyticsTargetBaseSchema = z.object({
  type: analyticsFreeTargetTypeSchema,
  target_scope: analyticsTargetScopeSchema,
  name: nameSchema,
  code: z.string().trim().max(60).optional(),
  description: descriptionSchema,
  unit_ids: z.array(idRefSchema).max(200).optional(),
  parent_id: idRefSchema.optional(),
  group_id: idRefSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().default(true),
});

function refineAnalyticsTargetScope(
  data: z.infer<typeof analyticsTargetBaseSchema>,
  ctx: z.RefinementCtx
) {
  const isLocal = data.type === "location" || data.type === "free_target";
  const hasUnits = (data.unit_ids?.length ?? 0) > 0;

  if (isLocal && data.target_scope !== "workspace" && !hasUnits) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unit_ids"],
      message:
        'Alvo local exige ao menos uma unidade, ou target_scope="workspace".',
    });
  }

  if (data.target_scope === "unit" && (data.unit_ids?.length ?? 0) !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target_scope"],
      message: 'Escopo "unit" exige exatamente uma unidade.',
    });
  }

  if (data.target_scope === "workspace" && hasUnits) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unit_ids"],
      message: "Alvo global nao deve listar unidades.",
    });
  }
}

export const createAnalyticsTargetSchema = analyticsTargetBaseSchema
  .strict()
  .superRefine(refineAnalyticsTargetScope);

export const updateAnalyticsTargetSchema = analyticsTargetBaseSchema
  .omit({ type: true })
  .partial()
  .strict();

export const analyticsTargetDocSchema = analyticsTargetBaseSchema
  .extend({
    id: idRefSchema,
    workspace_id: idRefSchema,
    ...governanceDocFields,
  })
  .strict()
  .superRefine(refineAnalyticsTargetScope);

export type CreateAnalyticsDomainInput = z.infer<
  typeof createAnalyticsDomainSchema
>;
export type UpdateAnalyticsDomainInput = z.infer<
  typeof updateAnalyticsDomainSchema
>;
export type CreateAnalyticsCriterionInput = z.infer<
  typeof createAnalyticsCriterionSchema
>;
export type UpdateAnalyticsCriterionInput = z.infer<
  typeof updateAnalyticsCriterionSchema
>;
export type CreateAnalyticsResultInput = z.infer<
  typeof createAnalyticsResultSchema
>;
export type UpdateAnalyticsResultInput = z.infer<
  typeof updateAnalyticsResultSchema
>;
export type CreateAnalyticsTargetInput = z.infer<
  typeof createAnalyticsTargetSchema
>;
export type UpdateAnalyticsTargetInput = z.infer<
  typeof updateAnalyticsTargetSchema
>;
