import { z } from 'zod';
import { absenceCivilDateSchema, absenceRequestPreviewSchema, absenceRequestTargetUidSchema } from './schemas';

const uuid = z.string().uuid();
const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const createAbsenceDraftSchema = z.object({
  idempotencyKey: uuid,
  beneficiaryUid: absenceRequestTargetUidSchema.optional(),
  proposedRequestId: uuid.optional(),
  request: absenceRequestPreviewSchema,
  preparationIds: z.array(uuid).max(5).default([]),
}).strict();
export const absenceActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit'), expectedVersion: z.number().int().positive(), operationId: uuid }).strict(),
  z.object({ action: z.literal('approve'), expectedVersion: z.number().int().positive(), operationId: uuid, confirmProfile: z.boolean().optional(), profileReason: z.string().trim().min(10).max(1000).optional() }).strict(),
  z.object({ action: z.literal('confirm_profile'), expectedVersion: z.number().int().positive(), operationId: uuid, reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal('reject'), expectedVersion: z.number().int().positive(), operationId: uuid, reason: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal('request_adjustments'), expectedVersion: z.number().int().positive(), operationId: uuid, reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal('cancel'), expectedVersion: z.number().int().positive(), operationId: uuid, reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal('update_draft'), expectedVersion: z.number().int().positive(), operationId: uuid,
    request: absenceRequestPreviewSchema, preparationRef: uuid.optional(), preparationIds: z.array(uuid).max(5).default([]) }).strict(),
]);
export const absenceRequestRouteSchema = z.object({ requestId }).strict();
export const absenceListQuerySchema = z.object({
  scope: z.enum(['mine', 'review', 'team']).default('mine'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: requestId.optional(),
  beneficiaryUid: absenceRequestTargetUidSchema.optional(),
  status: z.enum(['draft', 'submitted', 'in_review', 'adjustments_requested', 'approved', 'rejected', 'cancelled']).optional(),
  unitId: requestId.optional(),
  startDate: absenceCivilDateSchema.optional(),
  endDate: absenceCivilDateSchema.optional(),
  overdueOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}).strict().superRefine((value, context) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'Período inválido.' });
  }
  if (value.overdueOnly && (value.startDate || value.endDate)) {
    context.addIssue({ code: 'custom', path: ['overdueOnly'], message: 'Use o filtro de vencimento separado do período de início.' });
  }
  if (value.overdueOnly && value.status && value.status !== 'in_review') {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Somente solicitações em análise podem estar vencidas.' });
  }
});
export type CreateAbsenceDraftInput = z.infer<typeof createAbsenceDraftSchema>;
export type AbsenceActionInput = z.infer<typeof absenceActionSchema>;
