import { z } from 'zod';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const operationId = z.string().uuid();

export const createShiftSwapSchema = z.object({
  scheduleId: id,
  offeredShiftId: id,
  requestedShiftId: id,
  operationId,
  reason: z.string().trim().min(5).max(500).optional(),
}).strict();

export const shiftSwapRouteSchema = z.object({ requestId: id }).strict();

export const decideShiftSwapSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), expectedVersion: z.number().int().min(1), operationId }).strict(),
  z.object({ action: z.literal('reject'), expectedVersion: z.number().int().min(1), operationId,
    reason: z.string().trim().min(5).max(500) }).strict(),
  z.object({ action: z.literal('cancel'), expectedVersion: z.number().int().min(1), operationId }).strict(),
]);

export type CreateShiftSwapInput = z.infer<typeof createShiftSwapSchema>;
export type DecideShiftSwapInput = z.infer<typeof decideShiftSwapSchema>;
