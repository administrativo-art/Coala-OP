import { z } from "zod";

import { closureDateSchema } from "@/features/financial/cash-closures/schemas";
import { CASH_COUNTING_DENOMINATION_VALUES_CENTS } from "./types";

export const createCashCountingSessionSchema = z.object({
  kioskIds: z.array(z.string().trim().min(1).max(160)).min(1).max(12),
}).strict().superRefine((input, context) => {
  if (new Set(input.kioskIds).size !== input.kioskIds.length) {
    context.addIssue({ code: "custom", message: "A mesma unidade foi selecionada mais de uma vez.", path: ["kioskIds"] });
  }
});

export const saveCashCountingSessionDraftPositionSchema = z.object({
  kioskId: z.string().trim().min(1).max(160),
  date: closureDateSchema,
}).strict();

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
