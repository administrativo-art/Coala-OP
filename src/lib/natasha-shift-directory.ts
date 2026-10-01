import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(180);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const natashaShiftDirectoryRequestSchema = z.object({
  unitIds: z.array(idSchema).min(1).max(5),
}).strict().superRefine((input, context) => {
  if (new Set(input.unitIds).size !== input.unitIds.length) {
    context.addIssue({ code: 'custom', path: ['unitIds'], message: 'Unidade repetida.' });
  }
});

const shiftDocumentSchema = z.object({
  id: idSchema,
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(180),
  startTime: timeSchema,
  endTime: timeSchema,
  breakStart: timeSchema.optional(),
  breakEnd: timeSchema.optional(),
  unitId: idSchema.optional(),
  unitIds: z.array(idSchema).max(20).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
}).passthrough().superRefine((shift, context) => {
  if (shift.endTime <= shift.startTime) {
    context.addIssue({ code: 'custom', path: ['endTime'], message: 'Fim deve ser posterior ao início.' });
  }
  if (new Set(shift.daysOfWeek).size !== shift.daysOfWeek.length) {
    context.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'Dia da semana repetido.' });
  }
  if (Boolean(shift.breakStart) !== Boolean(shift.breakEnd)) {
    context.addIssue({ code: 'custom', path: ['breakStart'], message: 'Intervalo incompleto.' });
  } else if (shift.breakStart && shift.breakEnd
    && !(shift.startTime < shift.breakStart && shift.breakStart < shift.breakEnd && shift.breakEnd < shift.endTime)) {
    context.addIssue({ code: 'custom', path: ['breakStart'], message: 'Intervalo fora do turno.' });
  }
});

export const natashaShiftDirectorySourceSchema = z.object({
  unitIds: z.array(idSchema).min(1).max(5),
  documents: z.array(z.record(z.string(), z.unknown())).max(500),
  sourceQuery: z.string().trim().min(1).max(300),
}).strict();

const normalizedShiftSchema = z.object({
  id: idSchema,
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(180),
  startTime: timeSchema,
  endTime: timeSchema,
  breakStart: timeSchema.nullable(),
  breakEnd: timeSchema.nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  allowedUnitIds: z.array(idSchema).min(1).max(5),
  global: z.boolean(),
}).strict();

export const natashaShiftDirectoryReportSchema = z.object({
  status: z.enum(['ready_for_confirmation', 'incomplete']),
  scope: z.literal('shift_definitions_for_requested_units'),
  unitIds: z.array(idSchema).min(1).max(5),
  shiftDefinitions: z.array(normalizedShiftSchema).max(100),
  issues: z.array(z.object({
    code: z.enum(['MALFORMED_SHIFT_DEFINITION', 'NO_SHIFT_DEFINITIONS', 'SHIFT_DEFINITION_LIMIT_REACHED']),
    shiftDefinitionId: idSchema.optional(),
  }).strict()),
  evidence: z.object({
    sourceQuery: z.string(),
    sourceDocumentsRead: z.number().int().min(0).max(500),
    definitionsOutsideScopeOmitted: z.number().int().min(0),
    requiresHumanConfirmation: z.literal(true),
    slotClassificationsIncluded: z.literal(false),
  }).strict(),
}).strict();

export type NatashaShiftDirectoryReport = z.infer<typeof natashaShiftDirectoryReportSchema>;

/** Normaliza apenas definições de horário; abertura/fechamento/intermediário nunca é inferido do nome ou código. */
export function prepareNatashaShiftDirectory(
  raw: z.input<typeof natashaShiftDirectorySourceSchema>,
): NatashaShiftDirectoryReport {
  const source = natashaShiftDirectorySourceSchema.parse(raw);
  natashaShiftDirectoryRequestSchema.parse({ unitIds: source.unitIds });
  const expected = new Set(source.unitIds);
  const issues: NatashaShiftDirectoryReport['issues'] = [];
  const definitions: NatashaShiftDirectoryReport['shiftDefinitions'] = [];
  let definitionsOutsideScopeOmitted = 0;

  for (const rawDocument of source.documents) {
    const parsed = shiftDocumentSchema.safeParse(rawDocument);
    if (!parsed.success) {
      const shiftDefinitionId = typeof rawDocument.id === 'string' && rawDocument.id.trim()
        ? rawDocument.id.trim() : undefined;
      issues.push({ code: 'MALFORMED_SHIFT_DEFINITION', ...(shiftDefinitionId ? { shiftDefinitionId } : {}) });
      continue;
    }
    const document = parsed.data;
    const linkedUnitIds = document.unitIds?.length ? document.unitIds : document.unitId ? [document.unitId] : [];
    const global = linkedUnitIds.length === 0;
    const allowedUnitIds = global ? source.unitIds : source.unitIds.filter((unitId) => linkedUnitIds.includes(unitId));
    if (allowedUnitIds.length === 0) {
      definitionsOutsideScopeOmitted += 1;
      continue;
    }
    definitions.push({
      id: document.id,
      code: document.code,
      name: document.name,
      startTime: document.startTime,
      endTime: document.endTime,
      breakStart: document.breakStart ?? null,
      breakEnd: document.breakEnd ?? null,
      daysOfWeek: [...document.daysOfWeek].sort((left, right) => left - right),
      allowedUnitIds,
      global,
    });
  }

  definitions.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id));
  if (definitions.length === 0) issues.push({ code: 'NO_SHIFT_DEFINITIONS' });
  if (definitions.length > 100) issues.push({ code: 'SHIFT_DEFINITION_LIMIT_REACHED' });
  return natashaShiftDirectoryReportSchema.parse({
    status: issues.length === 0 && definitions.length <= 100 ? 'ready_for_confirmation' : 'incomplete',
    scope: 'shift_definitions_for_requested_units',
    unitIds: source.unitIds,
    shiftDefinitions: definitions.slice(0, 100),
    issues,
    evidence: {
      sourceQuery: source.sourceQuery,
      sourceDocumentsRead: source.documents.length,
      definitionsOutsideScopeOmitted,
      requiresHumanConfirmation: true,
      slotClassificationsIncluded: false,
    },
  });
}
