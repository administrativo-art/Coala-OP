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

const recruitmentDisplaySchema = z.object({
  locationLabel: z.string().trim().max(120).optional(),
  workType: z.enum(["presencial", "remoto", "hibrido"]).optional(),
  deadlineLabel: z.string().trim().max(80).optional(),
  buttonText: z.string().trim().max(80).optional(),
}).optional();

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
  sectionId: z.string().trim().max(80).optional(),
  sectionTitle: z.string().trim().max(120).optional(),
  sectionOrder: z.number().int().nonnegative().optional(),
  parentQuestionId: z.string().trim().max(120).optional(),
  subquestionOrder: z.number().int().nonnegative().optional(),
  required: z.boolean().default(false),
  scored: z.boolean().default(false),
  weight: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  eliminatory: z.boolean().default(false),
  expectedAnswer: z.unknown().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  config: z.record(z.unknown()).optional(),
  conditions: z.array(z.object({
    questionId: z.string().trim().min(1).max(120),
    operator: z.enum(["equals", "not_equals", "includes", "answered", "not_answered"]),
    value: z.unknown().optional(),
  })).optional(),
  scoring: z.object({
    criterionCode: z.string().trim().max(80).optional(),
    criterionLabel: z.string().trim().max(120).optional(),
    category: z.enum([
      "availability",
      "experience",
      "technical",
      "behavioral",
      "interest",
      "retention",
      "differentials",
    ]).optional(),
    groupId: z.string().trim().max(80).optional(),
    groupName: z.string().trim().max(80).optional(),
    use: z.enum(["informational", "scored", "eliminatory"]).optional(),
    importance: z.enum(["low", "medium", "high", "critical"]).optional(),
    justification: z.string().trim().max(500).optional(),
    sourceLayer: z.enum(["role", "function", "opening"]).optional(),
    answerFactors: z.record(z.number().min(0).max(1)).optional(),
    finalWeight: z.number().optional(),
    rubric: z.array(z.object({
      factor: z.number().min(0).max(1),
      label: z.string().trim().min(1).max(80),
      description: z.string().trim().max(240).optional(),
    })).optional(),
  }).optional(),
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
  recruitmentDisplay: recruitmentDisplaySchema,
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
  publicRequirements: stringListSchema,
  benefits: stringListSchema,
  workSchedule: z.string().trim().max(250).optional(),
  publicSalaryRange: salaryRangeSchema.optional(),
  recruitmentDisplay: recruitmentDisplaySchema,
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
  const normalized = (questions ?? []).map((question) =>
    stripUndefined({
      ...question,
      id: question.id ?? randomUUID(),
      sectionId: question.sectionId?.trim() || undefined,
      sectionTitle: question.sectionTitle?.trim() || undefined,
      parentQuestionId: question.parentQuestionId?.trim() || undefined,
      tags: normalizeStringList(question.tags),
      config: question.config && Object.keys(question.config).length > 0
        ? question.config
        : undefined,
      conditions: question.conditions && question.conditions.length > 0
        ? question.conditions
        : undefined,
      scoring: question.scoring && Object.keys(question.scoring).length > 0
        ? question.scoring
        : undefined,
      expectedAnswer:
        question.expectedAnswer === undefined ? undefined : question.expectedAnswer,
    })
  );
  const indexById = new Map(normalized.map((question, index) => [question.id, index]));
  return normalized.map((question, index) => {
    const parentIndex = question.parentQuestionId ? indexById.get(question.parentQuestionId) : undefined;
    const hasValidParent = parentIndex !== undefined && parentIndex < index;
    const conditions = question.conditions?.filter((condition) => {
      const conditionIndex = indexById.get(condition.questionId);
      return conditionIndex !== undefined && conditionIndex < index;
    });

    return stripUndefined({
      ...question,
      parentQuestionId: hasValidParent ? question.parentQuestionId : undefined,
      subquestionOrder: hasValidParent ? question.subquestionOrder : undefined,
      conditions: conditions && conditions.length > 0 ? conditions : undefined,
    });
  });
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

function normalizeRecruitmentDisplay(
  display: z.infer<NonNullable<typeof recruitmentDisplaySchema>> | undefined
) {
  if (display === undefined) return undefined;
  const normalized = stripUndefined({
    locationLabel: display.locationLabel?.trim() || undefined,
    workType: display.workType || undefined,
    deadlineLabel: display.deadlineLabel?.trim() || undefined,
    buttonText: display.buttonText?.trim() || undefined,
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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
    recruitmentDisplay: normalizeRecruitmentDisplay(input.recruitmentDisplay),
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
    recruitmentDisplay: normalizeRecruitmentDisplay(input.recruitmentDisplay),
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
    publicRequirements: normalizeStringList(input.publicRequirements),
    benefits: normalizeStringList(input.benefits),
    recruitmentDisplay: normalizeRecruitmentDisplay(input.recruitmentDisplay),
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
    publicRequirements:
      input.publicRequirements === undefined
        ? undefined
        : normalizeStringList(input.publicRequirements),
    benefits:
      input.benefits === undefined
        ? undefined
        : normalizeStringList(input.benefits),
    recruitmentDisplay: normalizeRecruitmentDisplay(input.recruitmentDisplay),
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
