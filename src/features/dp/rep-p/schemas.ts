import { z } from 'zod';

import { isCivilDate } from '@/features/dp/employment-reference/resolve';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const date = z.string().refine(isCivilDate, 'Data civil inválida.');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeElapsed = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const locationCaptureBase = z.object({
  captureId: id,
  elapsedMs: z.number().int().nonnegative().max(60_000),
});

export const repPLocationAttemptSchema = z.discriminatedUnion('status', [
  locationCaptureBase.extend({
    status: z.literal('captured'),
    capturedAt: z.string().datetime({ offset: true }),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().positive().max(100_000),
  }).strict(),
  ...(['denied', 'unavailable', 'timeout', 'unsupported', 'error'] as const).map((status) =>
    locationCaptureBase.extend({ status: z.literal(status) }).strict()),
]);

export const repPOfflineEvidenceSchema = z.object({
  permitId: id,
  deviceKeyId: sha256,
  elapsedRealtimeMs: safeElapsed,
  bootCount: z.number().int().nonnegative().max(1_000_000),
  sequence: z.number().int().positive().max(10_000),
  previousLocalHash: sha256.nullable(),
  markedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{4}$/),
  localHash: sha256,
  signature: z.string().min(80).max(256).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();

export const repPMarkingSchema = z.object({
  attemptId: id,
  workDate: date,
  executionUnitId: id,
  channel: z.enum(['mobile', 'browser']),
  offline: repPOfflineEvidenceSchema.optional(),
  locationAttempt: repPLocationAttemptSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.offline && value.channel !== 'mobile') context.addIssue({ code: 'custom', path: ['channel'], message: 'Marcação offline exige o Coala Go.' });
  if (value.offline && value.locationAttempt) context.addIssue({ code: 'custom', path: ['locationAttempt'],
    message: 'A contingência offline não aceita localização sem assinatura criptográfica própria.' });
});

export const repPOfflinePermitSchema = z.object({
  permitRequestId: id,
  workDate: date,
  installationId: z.string().uuid(),
  deviceKeyId: sha256,
  devicePublicKey: z.string().min(80).max(1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  keySecurity: z.enum(['tee', 'strongbox']),
  bootCount: z.number().int().nonnegative().max(1_000_000),
  anchorElapsedRealtimeMs: safeElapsed,
}).strict();

export const repPAfdExportSchema = z.object({
  establishmentId: id,
  startDate: date,
  endDate: date,
}).strict().refine((value) => value.startDate <= value.endDate, { message: 'Período inválido.' });

const MAX_HISTORY_DAYS = 62;

export const repPOwnHistorySchema = z.object({
  startDate: date,
  endDate: date,
}).strict().refine((value) => value.startDate <= value.endDate
  && (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) / 86_400_000 < MAX_HISTORY_DAYS,
{ message: `Período inválido ou maior que ${MAX_HISTORY_DAYS} dias.` });

export const repPOwnOptionsSchema = z.object({ workDate: date }).strict();

export type RepPOwnOptionsRequest = z.infer<typeof repPOwnOptionsSchema>;
export type RepPOwnHistoryRequest = z.infer<typeof repPOwnHistorySchema>;
export type RepPMarkingRequest = z.infer<typeof repPMarkingSchema>;
export type RepPLocationAttemptRequest = z.infer<typeof repPLocationAttemptSchema>;
export type RepPOfflinePermitRequest = z.infer<typeof repPOfflinePermitSchema>;
export type RepPAfdExportRequest = z.infer<typeof repPAfdExportSchema>;

export const repPOwnMonthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido.') }).strict();
export type RepPOwnMonthRequest = z.infer<typeof repPOwnMonthSchema>;
