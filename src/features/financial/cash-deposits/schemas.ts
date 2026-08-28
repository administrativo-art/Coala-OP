import { z } from "zod";

import { CASH_DEPOSIT_MAX_CENTS } from "./types";

export const prepareCashDepositCoinsSchema = z.object({
  coinCents: z.number().int().min(0).max(CASH_DEPOSIT_MAX_CENTS),
}).strict();

export const registerCashCoinExchangeSchema = z.object({
  kioskId: z.string().trim().min(1).max(120),
  amountCents: z.number().int().positive().max(CASH_DEPOSIT_MAX_CENTS),
  operationId: z.string().uuid(),
}).strict();

export const issueCashDepositSchema = z.object({
  dueBusinessDays: z.number().int().min(0).max(30).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().refine(
  (value) => value.dueBusinessDays === undefined || value.dueDate === undefined,
  "Informe o prazo ou a data de vencimento, não ambos.",
);
