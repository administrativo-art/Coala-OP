import { z } from "zod";

const identifier = z.string().trim().min(1).max(180).refine((value) => !value.includes("/"));

export const cashDifferenceListQuerySchema = z.object({
  kioskId: identifier,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const cashDifferenceDecisionSchema = z.object({
  classification: z.enum([
    "operational_loss",
    "unrecorded_sale",
    "incorrect_cash_movement",
    "employee_receivable",
    "unexplained_surplus",
    "counting_error",
    "integration_error",
  ]),
  accountPlanId: identifier.optional().nullable(),
  reason: z.string().trim().min(5).max(1_000),
}).strict();

export const cashClosureIdSchema = identifier;
