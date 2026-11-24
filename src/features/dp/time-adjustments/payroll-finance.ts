import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,180}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const payrollFinanceQuerySchema = z.object({ mode: z.enum(['salary', 'guide']), competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), employeeUid: id, expenseId: id }).strict();
export const payrollFinanceOptionsSchema = payrollFinanceQuerySchema.omit({ expenseId: true }).strict();
const document = z.object({ messageId: id, attachmentId: id, sha256: hash, documentKind: z.enum(['fgts', 'darf']), documentNumber: z.string().trim().min(3).max(100), taxpayerCnpj: z.string().trim().min(14).max(18), competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
export const payrollFinancePreviewSchema = payrollFinanceQuerySchema.extend({ amountCents: z.number().int().min(0).max(1_000_000_000_000), document: document.optional(), acknowledgment: z.literal(true) }).strict().superRefine((value, ctx) => {
  if ((value.mode === 'guide') !== Boolean(value.document)) ctx.addIssue({ code: 'custom', path: ['document'], message: 'Selecione o documento da guia; o salário usa o contracheque conferido.' });
});
export const payrollFinanceSubmitSchema = payrollFinanceQuerySchema.extend({ amountCents: z.number().int().min(0).max(1_000_000_000_000), document: document.optional(), acknowledgment: z.literal(true), expectedSourceHash: hash, expectedVersion: z.number().int().min(0), requestId: z.string().uuid() }).strict().superRefine((value, ctx) => {
  if ((value.mode === 'guide') !== Boolean(value.document)) ctx.addIssue({ code: 'custom', path: ['document'], message: 'Confira o documento selecionado.' });
});
export type PayrollFinanceQuery = z.infer<typeof payrollFinanceQuerySchema>;
export type PayrollFinancePreviewInput = z.infer<typeof payrollFinancePreviewSchema>;
export type PayrollFinanceSubmitInput = z.infer<typeof payrollFinanceSubmitSchema>;
export function strictMoneyCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('Valor monetário ausente ou inválido.');
  return Math.round(value * 100);
}
export type PayrollFinanceComparison = { status: 'match' | 'divergent'; documentCents: number; titleCents: number; nominalCents: number; allocationCents: number | null; differences: string[] };
export function comparePayrollMoney(input: { mode: 'salary' | 'guide'; documentCents: number; nominalCents: number; payableCents: number; allocationCents?: number; allocationsValid?: boolean }): PayrollFinanceComparison {
  const values = [input.documentCents, input.nominalCents, input.payableCents, ...(input.allocationCents === undefined ? [] : [input.allocationCents])];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('Informe os valores em centavos, sem arredondamento implícito.');
  const titleCents = input.mode === 'salary' ? input.payableCents : input.nominalCents;
  const differences: string[] = [];
  if (input.documentCents !== titleCents) differences.push(input.mode === 'salary' ? 'O líquido do contracheque difere do valor a pagar no título.' : 'O total da guia difere do total do título.');
  if (input.mode === 'guide' && (!input.allocationsValid || input.allocationCents === undefined)) differences.push('A individualização precisa fechar por conta contábil e no total do título.');
  if (input.mode === 'guide' && input.allocationCents !== input.documentCents) differences.push('A soma dos encargos individuais difere do total da guia.');
  return { status: differences.length ? 'divergent' : 'match', documentCents: input.documentCents, titleCents, nominalCents: input.nominalCents,
    allocationCents: input.mode === 'guide' ? input.allocationCents ?? null : null, differences };
}
