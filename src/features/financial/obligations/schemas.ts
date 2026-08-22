import { z } from "zod";

export const reportedPaymentSplitSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  paymentMethodId: z.string().min(1),
  paymentMethodLabel: z.string().min(1),
  amount: z.coerce.number().positive(),
});

export const registerReportedPaymentSchema = z.object({
  idempotencyKey: z.string().min(12).max(120),
  paidAt: z.string().datetime({ offset: true }),
  forecastExpenseId: z.string().min(1).optional().nullable(),
  interest: z.coerce.number().min(0).default(0),
  fine: z.coerce.number().min(0).default(0),
  notes: z.string().max(2_000).optional().default(""),
  splits: z.array(reportedPaymentSplitSchema).min(1).max(10),
  chargesAccountPlanId: z.string().optional().nullable(),
  chargesAccountPlanName: z.string().optional().nullable(),
}).superRefine((value, context) => {
  if (value.interest + value.fine > 0.009 && !value.chargesAccountPlanId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["chargesAccountPlanId"],
      message: "Selecione o plano de contas dos juros e multas.",
    });
  }
});

export type RegisterReportedPaymentInput = z.infer<typeof registerReportedPaymentSchema>;

export const adjustmentClassificationSchema = z.object({
  type: z.enum(["INTEREST", "FINE", "DISCOUNT", "ABATEMENT", "OTHER"]),
  reason: z.string().trim().min(3).max(2_000),
  responsibility: z.enum(["INTERNAL", "SUPPLIER", "BANK", "PUBLIC_AGENCY", "OTHER", "NOT_APPLICABLE", "UNDETERMINED"]),
  responsibleArea: z.string().trim().max(200).optional().nullable(),
  responsibleName: z.string().trim().max(200).optional().nullable(),
  accountPlanId: z.string().optional().nullable(),
  accountPlanName: z.string().optional().nullable(),
});

export type AdjustmentClassificationInput = z.infer<typeof adjustmentClassificationSchema>;
