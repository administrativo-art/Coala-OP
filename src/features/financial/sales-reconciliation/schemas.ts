import { z } from "zod";

const safeIdentifierSchema = z.string().trim().min(1).max(180).refine(
  (value) => !value.includes("/"),
  "O identificador não pode conter barra.",
);

const civilDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const moneyCentsSchema = z.number().int().nonnegative().max(100_000_000_000);

export const reconciliationSalesChannelSchema = z.enum(["pix", "debit_card", "credit_card"]);
export const reconciliationSaleStatusSchema = z.enum([
  "approved",
  "pending",
  "cancelled",
  "refunded",
  "chargeback",
]);

export const salesSourceIdentifiersSchema = z.object({
  providerTransactionId: z.string().trim().max(180).optional().nullable(),
  nsu: z.string().trim().max(80).optional().nullable(),
  authorizationCode: z.string().trim().max(80).optional().nullable(),
  terminalId: z.string().trim().max(120).optional().nullable(),
  merchantOrderId: z.string().trim().max(180).optional().nullable(),
});

export const canonicalPdvPaymentImportSchema = z.object({
  kioskId: safeIdentifierSchema,
  kioskName: z.string().trim().min(1).max(180).optional().nullable(),
  couponId: safeIdentifierSchema,
  paymentIndex: z.number().int().nonnegative().max(100),
  soldAt: z.string().trim().min(10).max(50),
  channel: z.string().trim().min(1).max(100),
  grossAmountCents: moneyCentsSchema,
  status: z.string().trim().min(1).max(80).default("approved"),
  operatorId: z.string().trim().max(180).optional().nullable(),
  identifiers: salesSourceIdentifiersSchema.default({}),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.string().trim().min(1).max(120),
});

export const canonicalStoneSaleImportSchema = z.object({
  externalTransactionId: safeIdentifierSchema,
  stoneCode: safeIdentifierSchema,
  kioskId: safeIdentifierSchema.optional().nullable(),
  kioskName: z.string().trim().min(1).max(180).optional().nullable(),
  soldAt: z.string().datetime({ offset: true }),
  channel: z.string().trim().min(1).max(100),
  grossAmountCents: moneyCentsSchema,
  installmentCount: z.number().int().min(1).max(99).default(1),
  brand: z.string().trim().max(80).optional().nullable(),
  status: z.string().trim().min(1).max(80),
  identifiers: salesSourceIdentifiersSchema.default({}),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.string().trim().min(1).max(120),
});

export const canonicalSalesImportBatchSchema = z.object({
  workspaceId: safeIdentifierSchema,
  source: z.enum(["pdv", "stone_sales"]),
  period: periodSchema,
  businessDate: civilDateSchema.optional(),
  rows: z.array(z.unknown()).min(1).max(5_000),
  idempotencyKey: z.string().trim().min(12).max(180),
});

export const salesReconciliationDecisionSchema = z.object({
  action: z.enum(["confirm", "classify", "ignore"]),
  classification: z.enum([
    "valid_sale",
    "stone_only_sale",
    "invalid_pdv_payment",
    "other_acquirer",
    "wrong_unit",
    "timing_difference",
    "cancelled_or_refunded",
  ]).optional(),
  reason: z.string().trim().min(5).max(2_000),
}).superRefine((value, context) => {
  if (value.action === "classify" && !value.classification) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["classification"],
      message: "Informe a classificação da divergência.",
    });
  }
});

export const salesReconciliationListQuerySchema = z.object({
  period: periodSchema,
  kioskId: safeIdentifierSchema.optional(),
  status: z.enum(["matched_auto", "pending_review", "resolved", "ignored"]).optional(),
  cursor: safeIdentifierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CanonicalPdvPaymentImport = z.infer<typeof canonicalPdvPaymentImportSchema>;
export type CanonicalStoneSaleImport = z.infer<typeof canonicalStoneSaleImportSchema>;
export type SalesReconciliationDecisionInput = z.infer<typeof salesReconciliationDecisionSchema>;
