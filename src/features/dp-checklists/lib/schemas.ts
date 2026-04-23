import { z } from "zod";

export const checklistItemTypes = [
  "checkbox",
  "text",
  "number",
  "temperature",
  "select",
  "photo",
  "signature",
] as const;

export const checklistItemConfigSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().trim().max(20).optional(),
  alertOutOfRange: z.boolean().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  minPhotos: z.number().int().min(1).optional(),
  maxPhotos: z.number().int().min(1).optional(),
});

export const checklistTemplateItemSchema = z.object({
  id: z.string().trim().min(1),
  order: z.number().int().min(0),
  title: z.string().trim().min(2, "Informe o título do item."),
  description: z.string().trim().max(500).optional(),
  type: z.enum(checklistItemTypes),
  required: z.boolean().default(true),
  weight: z.number().int().min(1).max(10).default(1),
  config: checklistItemConfigSchema.optional(),
});

export const checklistSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1, "Informe o título da seção.").max(200),
  order: z.number().int().min(0),
  items: z
    .array(checklistTemplateItemSchema)
    .min(1, "Inclua pelo menos um item na seção."),
});

export const checklistTemplateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do template."),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  unitIds: z.array(z.string().trim().min(1)).default([]),
  shiftDefinitionIds: z.array(z.string().trim().min(1)).default([]),
  isActive: z.boolean().default(true),
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

export const checklistExecutionItemUpdateSchema = z.object({
  templateItemId: z.string().trim().min(1),
  sectionId: z.string().trim().min(1),
  checked: z.boolean().optional(),
  textValue: z.string().optional(),
  numberValue: z.number().optional(),
  photoUrls: z.array(z.string()).optional(),
  signatureUrl: z.string().optional(),
});

export const checklistExecutionUpdateSchema = z.object({
  action: z.enum(["save", "complete"]),
  items: z.array(checklistExecutionItemUpdateSchema).default([]),
});

export type ChecklistTemplateInput = z.infer<typeof checklistTemplateSchema>;
export type ChecklistExecutionUpdateInput = z.infer<typeof checklistExecutionUpdateSchema>;
