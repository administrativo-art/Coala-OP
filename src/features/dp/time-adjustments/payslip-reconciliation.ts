import { z } from 'zod';
import type { ProviderClosureContent } from '@/features/service-portal/closure-types';

export const PAYSLIP_RECONCILIATION_SCOPE = 'point-quantities-v1' as const;
export const RECONCILIATION_KINDS = ['overtime', 'discount', 'expired_credit', 'bank_payroll'] as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,180}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const quantity = z.number().int().min(0).max(10_000_000);
const plainLine = { unit: z.literal('minutes'), quantity };
export const payslipReconciliationLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overtime'), ...plainLine, ratePercent: z.number().finite().min(0).max(1000) }).strict(),
  z.object({ kind: z.literal('discount'), ...plainLine }).strict(),
  z.object({ kind: z.literal('expired_credit'), ...plainLine }).strict(),
  z.object({ kind: z.literal('bank_payroll'), ...plainLine }).strict(),
]);
const transcription = {
  releaseId: id, documentId: id, documentHash: hash,
  lines: z.array(payslipReconciliationLineSchema).max(100),
  absentKinds: z.array(z.enum(RECONCILIATION_KINDS)).max(4), acknowledgment: z.literal(true),
};
function coverage(value: { lines: ReconciliationLine[]; absentKinds: ReconciliationKind[] }, ctx: z.RefinementCtx) {
  if (new Set(value.absentKinds).size !== value.absentKinds.length) ctx.addIssue({ code: 'custom', path: ['absentKinds'], message: 'Não repita a declaração de ausência.' });
  for (const kind of RECONCILIATION_KINDS) {
    const present = value.lines.some((line) => line.kind === kind);
    const absent = value.absentKinds.includes(kind);
    if (present === absent) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Informe a quantidade ou declare que a rubrica não consta no contracheque para cada tipo.' });
  }
}
export const payslipReconciliationQuerySchema = z.object({ competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), employeeUid: id }).strict();
export const payslipReconciliationPreviewSchema = z.object({ ...payslipReconciliationQuerySchema.shape, ...transcription }).strict().superRefine(coverage);
export const payslipReconciliationSubmitSchema = z.object({ ...payslipReconciliationQuerySchema.shape, ...transcription,
  expectedVersion: z.number().int().min(0), requestId: z.string().uuid(),
}).strict().superRefine(coverage);
export const reconciliationDocumentSchema = z.object({ ...payslipReconciliationQuerySchema.shape, documentId: id, documentHash: hash }).strict();
export type ReconciliationKind = typeof RECONCILIATION_KINDS[number];
export type ReconciliationLine = z.infer<typeof payslipReconciliationLineSchema>;
export type ReconciliationPreviewInput = z.infer<typeof payslipReconciliationPreviewSchema>;
export type ReconciliationSubmitInput = z.infer<typeof payslipReconciliationSubmitSchema>;
export type ReconciliationDifference = { code: 'missing' | 'unexpected' | 'quantity' | 'rate'; expected: ReconciliationLine | null; actual: ReconciliationLine | null };
export type PayslipComparison = {
  scope: typeof PAYSLIP_RECONCILIATION_SCOPE; status: 'match' | 'divergent';
  expected: ReconciliationLine[]; actual: ReconciliationLine[]; differences: ReconciliationDifference[];
  references: { unjustifiedAbsenceDates: string[]; nightMinutes: number };
};
function key(line: ReconciliationLine) { return JSON.stringify([line.kind, line.unit, line.kind === 'overtime' ? line.ratePercent : null]); }
export function normalizeReconciliationLines(lines: ReconciliationLine[]) {
  const totals = new Map<string, ReconciliationLine>();
  for (const line of lines) {
    const parsed = payslipReconciliationLineSchema.parse(line);
    const current = totals.get(key(parsed));
    totals.set(key(parsed), { ...parsed, quantity: parsed.quantity + (current?.quantity ?? 0) });
  }
  return [...totals.values()].sort((left, right) => key(left).localeCompare(key(right)));
}
export function expectedPayslipLines(content: ProviderClosureContent): ReconciliationLine[] {
  const numeric = [content.payroll.discountMinutes, content.payroll.expiredCreditMinutes, content.payroll.bankPayrollMinutes, content.payroll.payrollOvertimeMinutes];
  if (numeric.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('A entrega precisa conter todas as quantidades contábeis antes da conferência.');
  const overtime = content.payroll.overtime.filter((item) => item.destination === 'payroll')
    .map((item): ReconciliationLine => ({ kind: 'overtime', unit: 'minutes', quantity: item.minutes, ratePercent: item.ratePercent }));
  if (overtime.reduce((total, line) => total + line.quantity, 0) + content.payroll.expiredCreditMinutes + content.payroll.bankPayrollMinutes !== content.payroll.payrollOvertimeMinutes) {
    throw new Error('A entrega contém uma parcela de folha sem correspondência no escopo da conferência.');
  }
  return normalizeReconciliationLines([...overtime,
    { kind: 'discount', unit: 'minutes', quantity: content.payroll.discountMinutes },
    { kind: 'expired_credit', unit: 'minutes', quantity: content.payroll.expiredCreditMinutes },
    { kind: 'bank_payroll', unit: 'minutes', quantity: content.payroll.bankPayrollMinutes }]);
}
export function comparePayslipQuantities(content: ProviderClosureContent, lines: ReconciliationLine[], absentKinds: ReconciliationKind[]): PayslipComparison {
  const check = z.object({ lines: z.array(payslipReconciliationLineSchema).max(100), absentKinds: z.array(z.enum(RECONCILIATION_KINDS)).max(4) }).superRefine(coverage).parse({ lines, absentKinds });
  const expected = expectedPayslipLines(content);
  const actual = normalizeReconciliationLines([...check.lines, ...check.absentKinds.filter((kind) => kind !== 'overtime')
    .map((kind): ReconciliationLine => ({ kind, unit: 'minutes', quantity: 0 }))]);
  const remainingActual = new Map(actual.map((line) => [key(line), line]));
  const missing: ReconciliationLine[] = [];
  const differences: ReconciliationDifference[] = [];
  for (const line of expected) {
    const found = remainingActual.get(key(line));
    if (!found) missing.push(line);
    else {
      if (found.quantity !== line.quantity) differences.push({ code: 'quantity', expected: line, actual: found });
      remainingActual.delete(key(line));
    }
  }
  for (const line of missing) {
    const changedRate = line.kind === 'overtime' ? [...remainingActual.values()].find((other) => other.kind === 'overtime') : undefined;
    if (changedRate) {
      differences.push({ code: 'rate', expected: line, actual: changedRate }); remainingActual.delete(key(changedRate));
    } else differences.push({ code: 'missing', expected: line, actual: null });
  }
  for (const line of remainingActual.values()) differences.push({ code: 'unexpected', expected: null, actual: line });
  return { scope: PAYSLIP_RECONCILIATION_SCOPE, status: differences.length ? 'divergent' : 'match', expected, actual, differences,
    references: { unjustifiedAbsenceDates: [...content.payroll.unjustifiedAbsenceDates], nightMinutes: content.payroll.nightMinutes } };
}
export type PayslipReconciliationStamp = { id: string; inputHash: string; releaseId: string; documentId: string; documentHash: string; documentVersion: number };
