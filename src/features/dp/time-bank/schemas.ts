import { z } from 'zod';

const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const uid = z.string().trim().min(1).max(128);

export const timeBankQuerySchema = z.object({ employeeUid: uid.optional(), date: date.optional() }).strict();
export const timeBankActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), competence, expectedVersion: z.number().int().positive(), employeeUid: uid.optional() }).strict(),
  // Encerramento do ciclo pelo DP: grava o residual conferido (minutos esperados) com o destino da política.
  z.object({ action: z.literal('settle'), date, employeeUid: uid, expectedMinutes: z.number().int().min(-100000).max(100000) }).strict(),
]);
export type TimeBankActionInput = z.infer<typeof timeBankActionSchema>;
