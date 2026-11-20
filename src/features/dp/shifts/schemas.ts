import { z } from 'zod';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const workShiftRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
  shiftId: z.string().trim().min(1).max(180),
});

export const bulkWorkShiftRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
});

const dayBreakMinutes = z.number().int().min(0).max(480);
export const manualShiftDaySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed'), expectedBreakMinutes: dayBreakMinutes }).strict(),
  z.object({ mode: z.literal('flexible'), expectedWorkMinutes: z.number().int().min(1).max(1439),
    expectedBreakMinutes: dayBreakMinutes }).strict(),
]);

export const saveWorkShiftSchema = z.object({
  userId: z.string().trim().min(1).max(180),
  userName: z.string().trim().min(1).max(240).optional(),
  unitId: z.string().trim().min(1).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftDefinitionId: z.string().trim().min(1).max(180).optional(),
  manualDay: manualShiftDaySchema.optional(),
  manualOrder: z.number().int().min(0).max(31).optional(),
  travelFromPreviousMinutes: z.number().int().min(0).max(1439).optional(),
  manualBreak: z.object({ start: timeSchema, end: timeSchema }).strict().optional(),
  startTime: z.union([timeSchema, z.literal('')]),
  endTime: z.union([timeSchema, z.literal('')]),
  type: z.literal('work').optional(),
  exceptionReason: z.string().trim().min(3).max(500).optional(),
}).strict().refine(
  (shift) => shift.travelFromPreviousMinutes === undefined || Boolean(shift.manualDay),
  { path: ['travelFromPreviousMinutes'], message: 'O deslocamento exige uma jornada manual.' },
).refine(
  (shift) => !shift.manualDay || (!shift.shiftDefinitionId && (shift.endTime > shift.startTime || (shift.manualOrder != null && shift.manualDay.mode === 'flexible' && !shift.startTime && !shift.endTime))
    && (shift.manualDay.mode === 'fixed' || shift.manualDay.expectedWorkMinutes + shift.manualDay.expectedBreakMinutes <= 1440)),
  { path: ['manualDay'], message: 'Revise a carga, o intervalo e os horários do turno manual.' },
).refine(
  (shift) => !shift.manualBreak || (Boolean(shift.manualDay) && shift.startTime < shift.manualBreak.start
    && shift.manualBreak.start < shift.manualBreak.end && shift.manualBreak.end < shift.endTime),
  { path: ['manualBreak'], message: 'O intervalo precisa começar e terminar dentro do período manual.' },
).refine(
  (shift) => (Boolean(shift.startTime && shift.endTime) && shift.endTime !== shift.startTime)
    || (shift.manualOrder != null && shift.manualDay?.mode === 'flexible' && !shift.startTime && !shift.endTime),
  { message: 'O início e o fim do turno não podem ser iguais.' },
);

export type SaveWorkShiftInput = z.infer<typeof saveWorkShiftSchema>;

const bulkReplacePatchSchema = z.object({
  userId: z.string().trim().min(1).max(180).optional(),
  shiftDefinitionId: z.string().trim().min(1).max(180).nullable().optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  exceptionReason: z.string().trim().min(3).max(500).optional(),
}).strict().superRefine((patch, context) => {
  const hasStart = patch.startTime !== undefined;
  const hasEnd = patch.endTime !== undefined;
  if (hasStart !== hasEnd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Início e fim precisam ser enviados juntos.',
      path: hasStart ? ['endTime'] : ['startTime'],
    });
  }
  if (patch.startTime && patch.endTime && patch.endTime === patch.startTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O início e o fim do turno não podem ser iguais.',
      path: ['endTime'],
    });
  }
  if (!patch.userId && !hasStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Informe uma colaboradora ou um novo horário.',
    });
  }
});

const bulkCreateEntrySchema = z.object({
  userId: z.string().trim().min(1).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export const bulkWorkShiftSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('replace'),
    shiftIds: z.array(z.string().trim().min(1).max(180)).min(1).max(200),
    patch: bulkReplacePatchSchema,
  }).strict(),
  z.object({
    action: z.literal('delete'),
    shiftIds: z.array(z.string().trim().min(1).max(180)).min(1).max(200),
  }).strict(),
  z.object({
    action: z.literal('create'),
    shiftDefinitionId: z.string().trim().min(1).max(180),
    startTime: timeSchema,
    endTime: timeSchema,
    entries: z.array(bulkCreateEntrySchema).min(1).max(200),
  }).strict(),
]).superRefine((input, context) => {
  if (input.action === 'create') {
    if (input.startTime === input.endTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O início e o fim do turno não podem ser iguais.',
        path: ['endTime'],
      });
    }
    const keys = input.entries.map((entry) => `${entry.userId}::${entry.date}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A seleção contém a mesma colaboradora em uma data mais de uma vez.',
        path: ['entries'],
      });
    }
    return;
  }
  if (new Set(input.shiftIds).size !== input.shiftIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A seleção contém turnos duplicados.',
      path: ['shiftIds'],
    });
  }
});

export type BulkWorkShiftInput = z.infer<typeof bulkWorkShiftSchema>;

export const manualJourneyDraftSchema = z.object({
  userId: z.string().trim().min(1).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  manualDay: manualShiftDaySchema.optional(),
  removals: z.array(workShiftRouteSchema.extend({
    expectedDraftVersion: z.number().int().nonnegative(),
    expectedDraftGenerationId: z.string().min(1).max(180).regex(/^[^/]+$/),
    expectedOperationalVersion: z.number().int().nonnegative(),
  }).strict()).max(32).optional(),
  segments: z.array(workShiftRouteSchema.extend({
    expectedDraftVersion: z.number().int().nonnegative(),
    expectedDraftGenerationId: z.string().min(1).max(180).regex(/^[^/]+$/),
    expectedOperationalVersion: z.number().int().nonnegative(),
    existing: z.boolean(),
    manualDay: manualShiftDaySchema.optional(),
    unitId: z.string().trim().min(1).max(180),
    startTime: z.union([timeSchema, z.literal('')]),
    endTime: z.union([timeSchema, z.literal('')]),
    manualBreak: z.object({ start: timeSchema, end: timeSchema }).strict().optional(),
  }).strict()).min(1).max(32),
}).strict().superRefine((day, ctx) => {
  if (day.segments.some((segment) => segment.manualDay) && day.segments.some((segment) => !segment.manualDay)) {
    ctx.addIssue({ code: 'custom', path: ['segments'], message: 'Informe o regime de todos os trechos.' });
  }
  const keys = new Set<string>();
  for (const [index, removal] of (day.removals ?? []).entries()) {
    const key = JSON.stringify([removal.scheduleId, removal.shiftId]);
    if (keys.has(key) || removal.scheduleId.includes('/') || removal.shiftId.includes('/')) {
      ctx.addIssue({ code: 'custom', path: ['removals', index], message: 'Confira o trecho a retirar.' });
    }
    keys.add(key);
  }
  for (const [index, segment] of day.segments.entries()) {
    const key = JSON.stringify([segment.scheduleId, segment.shiftId]);
    const { unitId, startTime, endTime, manualBreak } = segment;
    if (keys.has(key) || segment.scheduleId.includes('/') || segment.shiftId.includes('/') || !(segment.manualDay ?? day.manualDay) || !saveWorkShiftSchema.safeParse({
      unitId, startTime, endTime, manualBreak, userId: day.userId, date: day.date, manualDay: segment.manualDay ?? day.manualDay, manualOrder: segment.manualDay ? index : undefined,
    }).success) {
      ctx.addIssue({ code: 'custom', path: ['segments', index], message: 'Confira os dados e os horários do trecho.' });
    }
    keys.add(key);
  }
});

export type ManualJourneyDraftInput = z.infer<typeof manualJourneyDraftSchema>;
