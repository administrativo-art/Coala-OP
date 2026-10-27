import { z } from 'zod';

import { isCivilDate } from '@/features/dp/employment-reference/resolve';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const civilDate = z.string().refine(isCivilDate, 'Data civil inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
/** Justificativa obrigatória: 10 a 1000 caracteres; os primeiros 150 vão para o AEJ. */
const reason = z.string().trim().min(10, 'A justificativa precisa ter ao menos 10 caracteres.').max(1000);

const legacyAdjustmentSchema = z.object({
  attemptId: z.string().uuid(),
  workDate: civilDate,
  kind: z.enum(['include', 'discard', 'correct']),
  targetReceiptId: id.optional(),
  newTime: time.optional(),
  executionUnitId: id.optional(),
  reason,
  scope: z.enum(['official', 'pilot']).optional(),
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

const adjustmentOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('include'), newTime: time, executionUnitId: id.optional() }).strict(),
  z.object({ kind: z.literal('discard'), targetReceiptId: id }).strict(),
  z.object({ kind: z.literal('correct'), targetReceiptId: id, newTime: time, executionUnitId: id.optional() }).strict(),
]);
const multiAdjustmentSchema = z.object({
  attemptId: z.string().uuid(), workDate: civilDate,
  operations: z.array(adjustmentOperationSchema).min(1, 'Inclua ao menos uma alteração.').max(8, 'Um pedido aceita até oito alterações.'),
  reason, scope: z.enum(['official', 'pilot']).optional(),
}).strict().superRefine((value, context) => {
  const kinds = new Set(value.operations.map((item) => item.kind));
  if (kinds.size > 1) context.addIssue({ code: 'custom', path: ['operations'], message: 'Um pedido reúne apenas alterações do mesmo tipo.' });
  const targets = value.operations.flatMap((item) => 'targetReceiptId' in item ? [item.targetReceiptId] : []);
  if (new Set(targets).size !== targets.length) context.addIssue({ code: 'custom', path: ['operations'], message: 'A mesma batida foi escolhida mais de uma vez.' });
  const inclusions = value.operations.flatMap((item) => 'newTime' in item ? [item.newTime] : []);
  if (new Set(inclusions).size !== inclusions.length) context.addIssue({ code: 'custom', path: ['operations'], message: 'O mesmo horário foi informado mais de uma vez.' });
});

export const createAdjustmentSchema = z.union([multiAdjustmentSchema, legacyAdjustmentSchema]).transform((value) => {
  if ('operations' in value) return value;
  return {
    attemptId: value.attemptId, workDate: value.workDate, reason: value.reason,
    scope: 'scope' in value ? value.scope : undefined,
    operations: [{ kind: value.kind, ...(value.targetReceiptId ? { targetReceiptId: value.targetReceiptId } : {}),
      ...(value.newTime ? { newTime: value.newTime } : {}), ...(value.executionUnitId ? { executionUnitId: value.executionUnitId } : {}) }],
  };
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

const uid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const mirrorQuerySchema = z.object({ competence, employeeUid: uid.optional() }).strict();
// A concordância do trabalhador passou a ser a assinatura do pacote do fechamento na Autentique (20/10/2026).
export const mirrorActionSchema = z.object({ action: z.literal('generate'), competence, expectedVersion: z.number().int().positive(),
  employeeUid: uid.optional() }).strict();
// Sem pessoa: resumo do mês (situação dos pacotes, atrasados e finalização).
export const closingPackageQuerySchema = z.object({ competence, employeeUid: uid.optional() }).strict();
const packageVersion = z.number().int().positive();
export const closingPackageActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), competence, expectedVersion: packageVersion, employeeUid: uid }).strict(),
  z.object({ action: z.literal('finalize'), competence, expectedVersion: packageVersion }).strict(),
]);
export type ClosingPackageActionInput = z.infer<typeof closingPackageActionSchema>;
export type MirrorActionInput = z.infer<typeof mirrorActionSchema>;

export const aejExportSchema = z.object({ establishmentId: id, startDate: civilDate, endDate: civilDate }).strict()
  .refine((value) => value.startDate <= value.endDate, { message: 'Período inválido.' });
export type AejExportInput = z.infer<typeof aejExportSchema>;
