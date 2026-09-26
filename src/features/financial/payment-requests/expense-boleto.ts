import { z } from "zod";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { financialCompetenceMonthSchema, financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const expenseBoletoSchema = z.object({
  barcode: z.string().transform(value => value.replace(/[.\s-]/g, "")).pipe(z.string().regex(/^\d{47}$/)),
  amountCents: z.coerce.number().int().positive().max(100_000_000),
  dueDate: isoDate,
  competenceMonth: financialCompetenceMonthSchema,
  beneficiaryDocument: z.string().transform(value => value.replace(/\D/g, "")).refine(value => CnpjValidator.validate(value).valid, "CNPJ do favorecido inválido."),
  documentReference: z.string().trim().min(1).max(100),
  confirmed: z.literal(true),
}).strict();
export const expenseBoletoPaymentSchema = z.object({ scheduledFor: isoDate, confirmed: z.literal(true) }).strict();
export type ExpenseBoletoInput = z.infer<typeof expenseBoletoSchema>;

function mod10(value: string) {
  let sum = 0;
  for (let i = value.length - 1, weight = 2; i >= 0; i--, weight = weight === 2 ? 1 : 2) {
    const product = Number(value[i]) * weight;
    sum += Math.floor(product / 10) + product % 10;
  }
  return (10 - sum % 10) % 10;
}
export function validateExpenseBoleto(input: ExpenseBoletoInput) {
  const code = input.barcode;
  for (const [start, length] of [[0, 9], [10, 10], [21, 10]]) {
    if (mod10(code.slice(start, start + length)) !== Number(code[start + length])) throw new Error("Dígitos verificadores da linha digitável inválidos.");
  }
  const bars = code.slice(0, 4) + code[32] + code.slice(33) + code.slice(4, 9) + code.slice(10, 20) + code.slice(21, 31);
  let sum = 0, weight = 2;
  const withoutDigit = bars.slice(0, 4) + bars.slice(5);
  for (let i = withoutDigit.length - 1; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(withoutDigit[i]) * weight;
  const raw = 11 - sum % 11, digit = raw === 0 || raw === 10 || raw === 11 ? 1 : raw;
  if (digit !== Number(bars[4]) || code[3] !== "9") throw new Error("Código bancário inválido.");
  if (Number(code.slice(37)) !== input.amountCents) throw new Error("O valor não confere com a linha digitável.");
  const due = new Date(`${input.dueDate}T00:00:00Z`).getTime();
  const factor = Number(code.slice(33, 37));
  const expected = input.dueDate >= "2025-02-22"
    ? 1000 + (due - Date.UTC(2025, 1, 22)) / 86_400_000
    : (due - Date.UTC(1997, 9, 7)) / 86_400_000;
  if (factor !== expected) throw new Error("O vencimento não confere com a linha digitável.");
}
export function assertExpenseBoletoTarget(expense: Record<string, any>, input: ExpenseBoletoInput, workspaceId: string) {
  if (expense.workspaceId !== workspaceId) throw new Error("Despesa fora do workspace.");
  if (!["pending", "provisioned"].includes(expense.status) || expense.paymentState === "paid" || expense.paidAt || expense.linkedBankTransactionId) throw new Error("A despesa não está disponível para pagamento.");
  if (expense.paymentMethod !== "single" || (expense.installments?.length ?? 0) > 1 || expense.financialInboxMessageId) throw new Error("Use o fluxo original para parcelas, cartão ou cobrança recebida.");
  if (Math.round(Number(expense.totalValue) * 100) !== input.amountCents) throw new Error("O valor do boleto difere da despesa.");
  const due = expense.dueDate?.toDate?.() ?? new Date(expense.dueDate);
  if (Number.isNaN(due.getTime()) || due.toISOString().slice(0, 10) !== input.dueDate) throw new Error("O vencimento difere da despesa.");
  if (financialExpenseCompetenceMonth(expense) !== input.competenceMonth) throw new Error("A competência difere da despesa.");
  const current = expense.documentIdentity?.barcode;
  if (current && current !== input.barcode) throw new Error("A despesa possui outro boleto.");
  if (expense.installments?.some((item: any) => item.status === "paid" || item.paidAt || item.financialInboxMessageId)) throw new Error("A parcela já possui pagamento ou cobrança vinculada.");
  validateExpenseBoleto(input);
}
