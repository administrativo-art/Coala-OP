import { z } from "zod";

export const confirmedBankBalanceSchema = z.object({
  balanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000),
  confirmedAt: z.string().datetime({ offset: true }),
  source: z.enum(["bank_statement", "stone_provider", "inter_provider", "manual_reconciliation"]),
  reason: z.string().trim().min(5).max(1_000),
}).strict();

export type ConfirmedBankBalanceInput = z.infer<typeof confirmedBankBalanceSchema>;

export function reaisToCents(value: number) {
  if (!Number.isFinite(value)) throw new Error("Saldo inválido.");
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Saldo inválido.");
  return cents;
}
