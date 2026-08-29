import { z } from "zod";

import { CASH_COUNTING_DENOMINATION_VALUES_CENTS } from "./types";

const periodSchema = z.object({
  year: z.number().int().min(2020).max(2200),
  month: z.number().int().min(1).max(12),
}).strict();

export const createCashCountingSessionSchema = z.object({
  kioskIds: z.array(z.string().trim().min(1).max(160)).min(1).max(12),
  periods: z.array(periodSchema).min(1).max(6),
}).strict().superRefine((input, context) => {
  if (new Set(input.kioskIds).size !== input.kioskIds.length) {
    context.addIssue({ code: "custom", message: "A mesma unidade foi selecionada mais de uma vez.", path: ["kioskIds"] });
  }
  const periodKeys = input.periods.map((period) => `${period.year}-${period.month}`);
  if (new Set(periodKeys).size !== periodKeys.length) {
    context.addIssue({ code: "custom", message: "A mesma competência foi selecionada mais de uma vez.", path: ["periods"] });
  }
  if (input.kioskIds.length * input.periods.length > 36) {
    context.addIssue({ code: "custom", message: "A sessão pode abranger no máximo 36 combinações de unidade e competência." });
  }
});

const denominationSchema = z.object({
  valueCents: z.number().int().refine(
    (value) => (CASH_COUNTING_DENOMINATION_VALUES_CENTS as readonly number[]).includes(value),
    "Denominação inválida.",
  ),
  quantity: z.number().int().min(0).max(1_000_000),
}).strict();

export const confirmCashCountingDenominationsSchema = z.object({
  denominations: z.array(denominationSchema).max(CASH_COUNTING_DENOMINATION_VALUES_CENTS.length),
}).strict();

export const finishCashCountingSessionSchema = z.object({}).strict();

export const cancelCashCountingSessionSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();
