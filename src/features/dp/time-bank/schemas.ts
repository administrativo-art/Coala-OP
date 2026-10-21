import { z } from 'zod';

const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const uid = z.string().trim().min(1).max(128);
const movementId = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const reason = z.string().trim().min(10, 'Informe um motivo com ao menos 10 caracteres.').max(1000);
const operationId = z.string().uuid();

export const timeBankQuerySchema = z.object({ employeeUid: uid.optional(), date: date.optional() }).strict();
export const timeBankActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), competence, expectedVersion: z.number().int().positive(), employeeUid: uid.optional() }).strict(),
  // Encerramento do ciclo pelo DP: grava o residual conferido (minutos esperados) com o destino da política.
  z.object({ action: z.literal('settle'), date, employeeUid: uid, expectedMinutes: z.number().int().min(-100000).max(100000) }).strict(),
  z.object({ action: z.literal('approve_overtime'), operationId, employeeUid: uid, date, categoryId: movementId,
    minutes: z.number().int().positive().max(24 * 60), reason }).strict(),
  z.object({ action: z.literal('movement'), operationId, employeeUid: uid, date,
    kind: z.enum(['compensation', 'adjustment', 'payroll']), minutes: z.number().int().min(-100000).max(100000).refine((value) => value !== 0),
    expectedBalance: z.number().int().min(-100000).max(100000), reason }).strict(),
  z.object({ action: z.literal('reverse'), employeeUid: uid, date, movementId, reason }).strict(),
]);
export type TimeBankActionInput = z.infer<typeof timeBankActionSchema>;
