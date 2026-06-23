import { randomUUID } from "crypto";

import { z } from "zod";

import {
  normalizeOnboardingDocumentTemplates,
  normalizeOnboardingStages,
} from "@/lib/recruitment-onboarding";
import { normalizeRecruitmentStages } from "@/lib/recruitment-pipeline";

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

const recruitmentStageSchema = z.object({
  id: z.enum([
    "applied",
    "screening",
    "interview",
    "technical_test",
    "offer",
    "hired",
  ]),
  label: z.string().trim().min(1).max(80),
  order: z.number().int().nonnegative().optional(),
  required: z.boolean().optional(),
  dueDays: z.number().int().nonnegative().nullable().optional(),
});

const onboardingStageSchema = z.object({
  id: z.enum([
    "documents",
    "document_review",
    "contract",
    "system_access",
    "integration",
    "probation",
    "done",
  ]),
  label: z.string().trim().min(1).max(100),
  order: z.number().int().nonnegative().optional(),
  required: z.boolean().optional(),
  dueDays: z.number().int().nonnegative().nullable().optional(),
});

const onboardingDocumentTemplateSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(120),
  required: z.boolean().default(true),
  order: z.number().int().nonnegative().optional(),
});

export const jobDepartmentCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  order: z.number().int().nonnegative().optional(),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
});

const jobRoleBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  publicTitle: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  departmentId: z.string().trim().min(1).nullable().optional(),
  departmentName: z.string().trim().min(1).max(120).nullable().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  order: z.number().int().nonnegative().optional(),
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
  pipelineStages: z.array(recruitmentStageSchema).optional(),
  onboardingStages: z.array(onboardingStageSchema).optional(),
  onboardingDocuments: z.array(onboardingDocumentTemplateSchema).optional(),
  isActive: z.boolean().default(true),
});

const jobFunctionBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  publicTitle: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  departmentId: z.string().trim().min(1).nullable().optional(),
  departmentName: z.string().trim().min(1).max(120).nullable().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  order: z.number().int().nonnegative().optional(),
  description: z.string().trim().max(4000).optional(),
  publicDescription: z.string().trim().max(4000).optional(),
  responsibilities: stringListSchema,
  publicResponsibilities: stringListSchema,
  requirements: stringListSchema,
  compatibleRoleIds: z.array(z.string().trim().min(1)).default([]),
  defaultProfileId: z.string().trim().min(1).optional(),
  formQuestions: z.array(formQuestionSchema).default([]),
  pipelineStages: z.array(recruitmentStageSchema).optional(),
  onboardingStages: z.array(onboardingStageSchema).optional(),
  onboardingDocuments: z.array(onboardingDocumentTemplateSchema).optional(),
  isActive: z.boolean().default(true),
});

export const jobRoleCreateSchema = jobRoleBaseSchema;
export const jobFunctionCreateSchema = jobFunctionBaseSchema;
export const jobDepartmentPatchSchema = jobDepartmentCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para atualização." }
);

export const jobRolePatchSchema = jobRoleBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para atualização." }
);

export const jobFunctionPatchSchema = jobFunctionBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para atualização." }
);

export function normalizeJobDepartmentInput(
  input: z.infer<typeof jobDepartmentCreateSchema>
) {
  return stripUndefined({
    ...input,
    slug: input.slug?.trim() || slugify(input.name),
    parentId: input.parentId ?? null,
    description: input.description?.trim() || undefined,
  });
}

export function normalizeJobDepartmentPatch(
  input: z.infer<typeof jobDepartmentPatchSchema>
) {
  return stripUndefined({
    ...input,
    slug:
      input.slug === undefined
        ? input.name
          ? slugify(input.name)
          : undefined
        : input.slug.trim() || (input.name ? slugify(input.name) : undefined),
    parentId: input.parentId === undefined ? undefined : input.parentId,
    description:
      input.description === undefined
        ? undefined
        : input.description.trim() || undefined,
  });
}

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

function normalizePipelineStageModel(
  stages?: Array<z.infer<typeof recruitmentStageSchema>>
) {
  if (stages === undefined) return undefined;
  if (stages.length === 0) return [];
  return normalizeRecruitmentStages(stages);
}

function normalizeOnboardingStageModel(
  stages?: Array<z.infer<typeof onboardingStageSchema>>
) {
  if (stages === undefined) return undefined;
  if (stages.length === 0) return [];
  return normalizeOnboardingStages(stages);
}

function normalizeOnboardingDocumentModel(
  documents?: Array<z.infer<typeof onboardingDocumentTemplateSchema>>
) {
  if (documents === undefined) return undefined;
  return normalizeOnboardingDocumentTemplates(documents);
}

export function normalizeJobRoleInput(
  input: z.infer<typeof jobRoleCreateSchema>
) {
  return stripUndefined({
    ...input,
    publicTitle: input.publicTitle?.trim() || input.name,
    slug: input.slug?.trim() || slugify(input.name),
    parentId: input.parentId ?? input.reportsTo ?? null,
    reportsTo: input.reportsTo ?? null,
    responsibilities: normalizeStringList(input.responsibilities),
    publicResponsibilities: normalizeStringList(input.publicResponsibilities),
    requirements: normalizeStringList(input.requirements),
    publicRequirements: normalizeStringList(input.publicRequirements),
    competencies: normalizeStringList(input.competencies),
    benefits: normalizeStringList(input.benefits),
    formQuestions: normalizeFormQuestions(input.formQuestions),
    pipelineStages: normalizePipelineStageModel(input.pipelineStages),
    onboardingStages: normalizeOnboardingStageModel(input.onboardingStages),
    onboardingDocuments: normalizeOnboardingDocumentModel(input.onboardingDocuments),
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
    parentId:
      input.parentId === undefined
        ? input.reportsTo === undefined
          ? undefined
          : input.reportsTo
        : input.parentId,
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
    pipelineStages: normalizePipelineStageModel(input.pipelineStages),
    onboardingStages: normalizeOnboardingStageModel(input.onboardingStages),
    onboardingDocuments: normalizeOnboardingDocumentModel(input.onboardingDocuments),
  });
}

export function normalizeJobFunctionInput(
  input: z.infer<typeof jobFunctionCreateSchema>
) {
  return stripUndefined({
    ...input,
    publicTitle: input.publicTitle?.trim() || input.name,
    slug: input.slug?.trim() || slugify(input.name),
    parentId: input.parentId ?? null,
    responsibilities: normalizeStringList(input.responsibilities),
    publicResponsibilities: normalizeStringList(input.publicResponsibilities),
    requirements: normalizeStringList(input.requirements),
    compatibleRoleIds: normalizeStringList(input.compatibleRoleIds),
    formQuestions: normalizeFormQuestions(input.formQuestions),
    pipelineStages: normalizePipelineStageModel(input.pipelineStages),
    onboardingStages: normalizeOnboardingStageModel(input.onboardingStages),
    onboardingDocuments: normalizeOnboardingDocumentModel(input.onboardingDocuments),
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
    parentId: input.parentId === undefined ? undefined : input.parentId,
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
    pipelineStages: normalizePipelineStageModel(input.pipelineStages),
    onboardingStages: normalizeOnboardingStageModel(input.onboardingStages),
    onboardingDocuments: normalizeOnboardingDocumentModel(input.onboardingDocuments),
  });
}
