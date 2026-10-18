import { z } from 'zod';

import { isCivilDate } from '@/features/dp/employment-reference/resolve';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const date = z.string().refine(isCivilDate, 'Data civil inválida.');

export const repPMarkingSchema = z.object({
  attemptId: id,
  workDate: date,
  executionUnitId: id,
  channel: z.enum(['mobile', 'browser']),
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
export type RepPAfdExportRequest = z.infer<typeof repPAfdExportSchema>;
