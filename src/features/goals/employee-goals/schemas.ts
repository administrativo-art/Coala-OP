import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(180);

export const createEmployeeGoalSchema = z.object({
  periodId: idSchema,
  employeeId: idSchema,
  kioskId: idSchema,
  shiftId: idSchema.optional(),
  participantSource: z.enum(['schedule', 'manual']).optional(),
  participantRole: z.enum(['fixed', 'relief', 'leader']).optional(),
  scheduledDays: z.number().int().min(0).max(366).optional(),
  scheduledTurnCount: z.number().int().min(0).max(2000).optional(),
  fraction: z.number().positive().max(1),
  targetValue: z.number().finite().min(0).max(1_000_000_000),
  currentValue: z.number().finite().min(0).max(1_000_000_000),
  dailyProgress: z.record(z.string(), z.number().finite().min(0).max(1_000_000_000)).optional(),
  distributionMode: z.enum(['calendar_days', 'scheduled_days']).optional(),
}).strict();

export type CreateEmployeeGoalInput = z.infer<typeof createEmployeeGoalSchema>;
