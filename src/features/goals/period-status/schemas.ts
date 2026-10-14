import { z } from 'zod';

export const goalPeriodStatusRouteSchema = z.object({
  periodId: z.string().trim().min(1).max(180),
}).strict();

export const transitionGoalPeriodSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['closed', 'cancelled']), closureNote: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ status: z.literal('active') }).strict(),
]);

export type TransitionGoalPeriodInput = z.infer<typeof transitionGoalPeriodSchema>;
