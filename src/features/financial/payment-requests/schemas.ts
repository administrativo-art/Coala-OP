import { z } from "zod";
import { paymentBeneficiaryReferenceSchema } from "../beneficiaries/schemas";

export const createPaymentRequestSchema = z.object({
  sourceType: z.enum(["aso", "generated_receipt", "termination"]),
  sourceId: z.string().trim().min(1).max(180),
  expenseId: z.string().trim().min(1).max(180).optional(),
  beneficiaryReference: paymentBeneficiaryReferenceSchema,
  amount: z.coerce.number().positive().max(1_000_000),
  description: z.string().trim().min(3).max(140),
});
