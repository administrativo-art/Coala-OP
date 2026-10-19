import { z } from 'zod';

import { isCivilDate } from '@/features/dp/employment-reference/resolve';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const civilDate = z.string().refine(isCivilDate, 'Data civil inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
/** Justificativa obrigatória: 10 a 1000 caracteres; os primeiros 150 vão para o AEJ. */
const reason = z.string().trim().min(10, 'A justificativa precisa ter ao menos 10 caracteres.').max(1000);

export const createAdjustmentSchema = z.object({
  attemptId: z.string().uuid(),
  workDate: civilDate,
  kind: z.enum(['include', 'discard', 'correct']),
  targetReceiptId: id.optional(),
  newTime: time.optional(),
  executionUnitId: id.optional(),
  reason,
}).strict().superRefine((value, context) => {
  if (value.kind !== 'include' && !value.targetReceiptId) {
    context.addIssue({ code: 'custom', path: ['targetReceiptId'], message: 'Escolha a batida.' });
  }
  if (value.kind === 'include' && value.targetReceiptId) {
    context.addIssue({ code: 'custom', path: ['targetReceiptId'], message: 'Inclusão não aponta batida existente.' });
  }
  if (value.kind !== 'discard' && !value.newTime) {
    context.addIssue({ code: 'custom', path: ['newTime'], message: 'Informe o horário.' });
  }
  if (value.kind === 'discard' && value.newTime) {
    context.addIssue({ code: 'custom', path: ['newTime'], message: 'Desconsiderar não informa horário novo.' });
  }
});

export const adjustmentDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), expectedVersion: z.number().int().positive(), reason }).strict(),
  z.object({ action: z.literal('reject'), expectedVersion: z.number().int().positive(), reason }).strict(),
  z.object({ action: z.literal('cancel'), expectedVersion: z.number().int().positive() }).strict(),
]);

export const adjustmentMonthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido.') }).strict();
export const adjustmentRouteSchema = z.object({ adjustmentId: id }).strict();

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type AdjustmentDecisionInput = z.infer<typeof adjustmentDecisionSchema>;
export type AdjustmentMonthInput = z.infer<typeof adjustmentMonthSchema>;

const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');
export const closureQuerySchema = z.object({ competence }).strict();
export const closureCloseSchema = z.object({ competence, expectedVersion: z.number().int().min(0) }).strict();
export const closureRouteSchema = z.object({ competence }).strict();
export const closureActionSchema = z.object({ action: z.literal('reopen'), expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10, 'O motivo precisa ter ao menos 10 caracteres.').max(1000) }).strict();

export type ClosureCloseInput = z.infer<typeof closureCloseSchema>;
export type ClosureActionInput = z.infer<typeof closureActionSchema>;
