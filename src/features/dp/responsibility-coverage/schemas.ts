import { z } from 'zod';

const id = z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/);
const uuid = z.string().uuid();

export const responsibilityActivitySchema = z.enum(['schedules', 'vacations', 'absences']);
export const responsibilityScopeSchema = z.object({
  kind: z.enum(['unit_group', 'unit']),
  id,
}).strict();

export const responsibilityLevelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('people'), personIds: z.array(id).min(1).max(20) }).strict(),
  z.object({ kind: z.literal('function'), functionId: id, fallbackJobRoleId: id.optional() }).strict(),
  z.object({ kind: z.literal('role'), jobRoleId: id }).strict(),
]);

export const saveResponsibilityCoverageSchema = z.object({
  activity: responsibilityActivitySchema,
  scope: responsibilityScopeSchema,
  levels: z.array(responsibilityLevelSchema).max(20),
  state: z.enum(['draft', 'active']),
  expectedVersion: z.number().int().nonnegative(),
  operationId: uuid,
}).strict();

export const responsibilityCoverageListSchema = z.object({
  activity: responsibilityActivitySchema.optional(),
}).strict();

export const responsibilityTaskListSchema = z.object({
  status: z.enum(['unassigned', 'pending', 'claimed', 'resolved']).optional(),
  activity: responsibilityActivitySchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: id.optional(),
}).strict();

export const responsibilityTaskActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), expectedVersion: z.number().int().positive(), operationId: uuid }).strict(),
  z.object({ action: z.literal('resolve'), expectedVersion: z.number().int().positive(), operationId: uuid,
    note: z.string().trim().min(10).max(1000) }).strict(),
]);

export const responsibilityTaskRouteSchema = z.object({ taskId: id }).strict();

export type SaveResponsibilityCoverageInput = z.infer<typeof saveResponsibilityCoverageSchema>;
export type ResponsibilityTaskActionInput = z.infer<typeof responsibilityTaskActionSchema>;
