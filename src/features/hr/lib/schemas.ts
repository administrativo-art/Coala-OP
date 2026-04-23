import { randomUUID } from "crypto";

import { z } from "zod";

const stringListSchema = z.array(z.string().trim().min(1)).default([]);

const salaryRangeSchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  currency: z.string().trim().min(3).max(8),
  visible: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (
    value.min !== undefined &&
    value.max !== undefined &&
    value.min > value.max
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "O valor mínimo não pode ser maior que o máximo.",
      path: ["min"],
    });
  }
});

const formQuestionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1).max(500),
  type: z.enum([
    "text",
    "yes_no",
    "select",
    "multi_select",
    "number_range",
    "date",
    "location",
    "file_upload",
  ]),
  required: z.boolean().default(false),
  scored: z.boolean().default(false),
  weight: z.enum(["low", "medium", "high"]).default("medium"),
  eliminatory: z.boolean().default(false),
  expectedAnswer: z.unknown().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  config: z.record(z.unknown()).optional(),
});

const jobRoleBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  publicTitle: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  reportsTo: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().max(4000).optional(),
  publicDescription: z.string().trim().max(4000).optional(),
  responsibilities: stringListSchema,
  publicResponsibilities: stringListSchema,
  requirements: stringListSchema,
  publicRequirements: stringListSchema,
  competencies: stringListSchema,
  benefits: stringListSchema,
  workSchedule: z.string().trim().max(250).optional(),
  salaryRange: salaryRangeSchema.optional(),
  publicSalaryRange: salaryRangeSchema.optional(),
  defaultProfileId: z.string().trim().min(1).optional(),
  loginRestricted: z.boolean().default(false),
  formQuestions: z.array(formQuestionSchema).default([]),
  isActive: z.boolean().default(true),
});

const jobFunctionBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  publicTitle: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  publicDescription: z.string().trim().max(4000).optional(),
  responsibilities: stringListSchema,
  publicResponsibilities: stringListSchema,
  requirements: stringListSchema,
  compatibleRoleIds: z.array(z.string().trim().min(1)).default([]),
  formQuestions: z.array(formQuestionSchema).default([]),
  isActive: z.boolean().default(true),
});

export const jobRoleCreateSchema = jobRoleBaseSchema;
export const jobFunctionCreateSchema = jobFunctionBaseSchema;

export const jobRolePatchSchema = jobRoleBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para atualização." }
);

export const jobFunctionPatchSchema = jobFunctionBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para atualização." }
);

export function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeStringList(input?: string[]) {
  return Array.from(
    new Set((input ?? []).map((entry) => entry.trim()).filter(Boolean))
  );
}

function normalizeFormQuestions(
  questions?: Array<z.infer<typeof formQuestionSchema>>
) {
  return (questions ?? []).map((question) =>
    stripUndefined({
      ...question,
      id: question.id ?? randomUUID(),
      tags: normalizeStringList(question.tags),
      config: question.config && Object.keys(question.config).length > 0
        ? question.config
        : undefined,
      expectedAnswer:
        question.expectedAnswer === undefined ? undefined : question.expectedAnswer,
    })
  );
}

export function normalizeJobRoleInput(
  input: z.infer<typeof jobRoleCreateSchema>
) {
  return stripUndefined({
    ...input,
    publicTitle: input.publicTitle?.trim() || input.name,
    slug: input.slug?.trim() || slugify(input.name),
    reportsTo: input.reportsTo ?? null,
    responsibilities: normalizeStringList(input.responsibilities),
    publicResponsibilities: normalizeStringList(input.publicResponsibilities),
    requirements: normalizeStringList(input.requirements),
    publicRequirements: normalizeStringList(input.publicRequirements),
    competencies: normalizeStringList(input.competencies),
    benefits: normalizeStringList(input.benefits),
    formQuestions: normalizeFormQuestions(input.formQuestions),
  });
}

export function normalizeJobRolePatch(
  input: z.infer<typeof jobRolePatchSchema>
) {
  return stripUndefined({
    ...input,
    publicTitle:
      input.publicTitle === undefined
        ? undefined
        : input.publicTitle.trim() || input.name,
    slug:
      input.slug === undefined
        ? input.name
          ? slugify(input.name)
          : undefined
        : input.slug.trim() || (input.name ? slugify(input.name) : undefined),
    reportsTo: input.reportsTo === undefined ? undefined : input.reportsTo,
    responsibilities:
      input.responsibilities === undefined
        ? undefined
        : normalizeStringList(input.responsibilities),
    publicResponsibilities:
      input.publicResponsibilities === undefined
        ? undefined
        : normalizeStringList(input.publicResponsibilities),
    requirements:
      input.requirements === undefined
        ? undefined
        : normalizeStringList(input.requirements),
    publicRequirements:
      input.publicRequirements === undefined
        ? undefined
        : normalizeStringList(input.publicRequirements),
    competencies:
      input.competencies === undefined
        ? undefined
        : normalizeStringList(input.competencies),
    benefits:
      input.benefits === undefined
        ? undefined
        : normalizeStringList(input.benefits),
    formQuestions:
      input.formQuestions === undefined
        ? undefined
        : normalizeFormQuestions(input.formQuestions),
  });
}

export function normalizeJobFunctionInput(
  input: z.infer<typeof jobFunctionCreateSchema>
) {
  return stripUndefined({
    ...input,
    publicTitle: input.publicTitle?.trim() || input.name,
    slug: input.slug?.trim() || slugify(input.name),
    responsibilities: normalizeStringList(input.responsibilities),
    publicResponsibilities: normalizeStringList(input.publicResponsibilities),
    requirements: normalizeStringList(input.requirements),
    compatibleRoleIds: normalizeStringList(input.compatibleRoleIds),
    formQuestions: normalizeFormQuestions(input.formQuestions),
  });
}

export function normalizeJobFunctionPatch(
  input: z.infer<typeof jobFunctionPatchSchema>
) {
  return stripUndefined({
    ...input,
    publicTitle:
      input.publicTitle === undefined
        ? undefined
        : input.publicTitle.trim() || input.name,
    slug:
      input.slug === undefined
        ? input.name
          ? slugify(input.name)
          : undefined
        : input.slug.trim() || (input.name ? slugify(input.name) : undefined),
    responsibilities:
      input.responsibilities === undefined
        ? undefined
        : normalizeStringList(input.responsibilities),
    publicResponsibilities:
      input.publicResponsibilities === undefined
        ? undefined
        : normalizeStringList(input.publicResponsibilities),
    requirements:
      input.requirements === undefined
        ? undefined
        : normalizeStringList(input.requirements),
    compatibleRoleIds:
      input.compatibleRoleIds === undefined
        ? undefined
        : normalizeStringList(input.compatibleRoleIds),
    formQuestions:
      input.formQuestions === undefined
        ? undefined
        : normalizeFormQuestions(input.formQuestions),
  });
}
