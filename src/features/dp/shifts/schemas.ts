import { z } from 'zod';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const workShiftRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
  shiftId: z.string().trim().min(1).max(180),
});

export const bulkWorkShiftRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
});

export const saveWorkShiftSchema = z.object({
  userId: z.string().trim().min(1).max(180),
  userName: z.string().trim().min(1).max(240).optional(),
  unitId: z.string().trim().min(1).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftDefinitionId: z.string().trim().min(1).max(180).optional(),
  startTime: timeSchema,
  endTime: timeSchema,
  type: z.literal('work').optional(),
}).strict().refine(
  (shift) => shift.endTime > shift.startTime,
  { message: 'O fim do turno deve ser posterior ao início.' },
);

export type SaveWorkShiftInput = z.infer<typeof saveWorkShiftSchema>;

const bulkReplacePatchSchema = z.object({
  userId: z.string().trim().min(1).max(180).optional(),
  shiftDefinitionId: z.string().trim().min(1).max(180).nullable().optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
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
  if (patch.startTime && patch.endTime && patch.endTime <= patch.startTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O fim do turno deve ser posterior ao início.',
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
]).superRefine((input, context) => {
  if (new Set(input.shiftIds).size !== input.shiftIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A seleção contém turnos duplicados.',
      path: ['shiftIds'],
    });
  }
});

export type BulkWorkShiftInput = z.infer<typeof bulkWorkShiftSchema>;
