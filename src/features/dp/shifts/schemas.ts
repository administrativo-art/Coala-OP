import { z } from 'zod';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const workShiftRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
  shiftId: z.string().trim().min(1).max(180),
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
