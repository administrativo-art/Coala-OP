import { z } from "zod";

import type { DPChecklistConditionalRule } from "@/types";

export const checklistItemTypes = [
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
] as const;

export const checklistTemplateTypes = [
  "routine",
  "audit",
  "incident",
  "one_time",
  "receiving",
  "maintenance",
] as const;

export const checklistOccurrenceTypes = [
  "manual",
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "annual",
  "custom",
] as const;

export const customScheduleSchema = z.object({
  modes: z.array(z.enum(["weekdays", "monthdays", "interval", "once"])).default([]),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  monthdays: z.array(z.number().int().min(1).max(31)).optional(),
  intervalDays: z.number().int().min(1).max(365).optional(),
  onceDates: z.array(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

export const annualScheduleSchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

export const checklistCriticalityLevels = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const checklistConditionalOperators = [
  "equals",
  "not_equals",
  "gt",
  "lt",
  "contains",
] as const;

export const showIfRuleSchema: z.ZodType<DPChecklistConditionalRule> = z.object({
  itemId: z.string().trim().min(1),
  operator: z.enum(checklistConditionalOperators),
  value: z.unknown(),
});

export const checklistItemConfigSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().trim().max(20).optional(),
  alertOutOfRange: z.boolean().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  minPhotos: z.number().int().min(1).optional(),
  maxPhotos: z.number().int().min(1).optional(),
});

export const checklistTemplateItemSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1),
    order: z.number().int().min(0),
    title: z.string().trim().min(2, "Informe o título do item."),
    description: z.string().trim().max(500).optional(),
    type: z.enum(checklistItemTypes),
    required: z.boolean().default(true),
    weight: z.number().int().min(0).max(10).default(1),
    blockNext: z.boolean().default(false),
    criticality: z.enum(checklistCriticalityLevels).default("low"),
    referenceValue: z.number().optional(),
    tolerancePercent: z.number().min(0).max(100).optional(),
    actionRequired: z.boolean().optional(),
    notifyRoleIds: z.array(z.string().trim().min(1)).optional(),
    escalationMinutes: z.number().int().min(1).optional(),
    showIf: showIfRuleSchema.optional(),
    conditionalBranches: z
      .array(
        z.object({
          value: z.unknown(),
          label: z.string().trim().min(1),
          items: z.array(checklistTemplateItemSchema),
        })
      )
      .optional(),
    config: checklistItemConfigSchema.optional(),
  })
);

export const checklistSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1, "Informe o título da seção.").max(200),
  order: z.number().int().min(0),
  showIf: showIfRuleSchema.optional(),
  requirePhoto: z.boolean().optional(),
  requireSignature: z.boolean().optional(),
  items: z
    .array(checklistTemplateItemSchema)
    .min(1, "Inclua pelo menos um item na seção."),
});

export const checklistTemplateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do template."),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  templateType: z.string().trim().min(1, "Selecione um tipo."),
  occurrenceType: z.enum(checklistOccurrenceTypes).optional(),
  annualSchedule: annualScheduleSchema.optional(),
  customSchedule: customScheduleSchema.optional(),
  unitIds: z.array(z.string().trim().min(1)).default([]),
  jobRoleIds: z.array(z.string().trim().min(1)).default([]),
  jobFunctionIds: z.array(z.string().trim().min(1)).default([]),
  shiftDefinitionIds: z.array(z.string().trim().min(1)).default([]),
  isActive: z.boolean().default(true),
  changeNotes: z.string().trim().max(500).optional(),
  sections: z
    .array(checklistSectionSchema)
    .min(1, "Inclua pelo menos uma seção com itens."),
});

export const checklistDateSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato YYYY-MM-DD."),
});

export const checklistManualExecutionSchema = z
  .object({
    templateId: z.string().trim().min(1).optional(),
    templateType: z.string().trim().min(1).optional(),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato YYYY-MM-DD.")
      .optional(),
    unitId: z.string().trim().min(1).optional(),
    assignedUserId: z.string().trim().min(1).optional(),
    collaboratorUserIds: z.array(z.string().trim().min(1)).optional(),
    incidentContext: z.string().trim().min(1).optional(),
    supplierName: z.string().trim().min(1).optional(),
    invoiceNumber: z.string().trim().min(1).optional(),
    scheduledDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato YYYY-MM-DD.")
      .optional(),
    sections: z.array(checklistSectionSchema).optional(),
    recurrence: z
      .object({
        type: z.enum(checklistOccurrenceTypes),
        annualSchedule: annualScheduleSchema.optional(),
        customSchedule: customScheduleSchema.optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.templateId && !value.templateType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe um tipo manual ou selecione um template.",
        path: ["templateType"],
      });
    }
  });

export const checklistExecutionItemUpdateSchema = z.object({
  templateItemId: z.string().trim().min(1),
  sectionId: z.string().trim().min(1),
  value: z.unknown().optional(),
  checked: z.boolean().optional(),
  textValue: z.string().optional(),
  numberValue: z.number().optional(),
  photoUrls: z.array(z.string()).optional(),
  signatureUrl: z.string().optional(),
  multiValues: z.array(z.string()).optional(),
  dateValue: z.string().optional(),
  yesNoValue: z.boolean().nullable().optional(),
});

export const checklistExecutionUpdateSchema = z.object({
  action: z.enum(["save", "complete"]),
  items: z.array(checklistExecutionItemUpdateSchema).default([]),
});

export type ChecklistTemplateInput = z.infer<typeof checklistTemplateSchema>;
export type ChecklistManualExecutionInput = z.infer<
  typeof checklistManualExecutionSchema
>;
export type ChecklistExecutionUpdateInput = z.infer<
  typeof checklistExecutionUpdateSchema
>;
