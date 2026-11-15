import { createHash } from "node:crypto";
import { z } from "zod";

export const inboxDareExpenseSchema = z.object({
  sourceAttachmentId: z.string().trim().min(1).max(170),
  sourceAttachmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  accountPlanId: z.string().trim().min(1).max(180),
  referenceResultCenterId: z.string().trim().min(1).max(180),
  apportionments: z.array(z.object({
    resultCenterId: z.string().trim().min(1).max(180),
    percentage: z.number().positive().max(100),
  }).strict()).min(2).max(10).refine((rows) =>
    new Set(rows.map((row) => row.resultCenterId)).size === rows.length
    && Math.abs(rows.reduce((sum, row) => sum + row.percentage, 0) - 100) < 0.001
    && rows.every((row) => Math.abs(row.percentage - 100 / rows.length) <= 0.01),
  ),
  documentConfirmation: z.object({
    amountCents: z.number().int().positive().max(1_000_000_000),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    competence: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    barcode: z.string().regex(/^\d{48}$/),
    supplierName: z.string().trim().min(3).max(200),
    supplierTaxId: z.null().optional(),
    fiscalIdentity: z.object({
      documentKind: z.literal("dare"),
      collectorName: z.string().trim().min(3).max(200),
      taxpayerName: z.string().trim().min(3).max(200),
      taxpayerTaxId: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(14)),
      documentNumber: z.string().trim().min(1).max(80).optional(),
      revenueCodes: z.array(z.string().trim().regex(/^\d{3,10}$/)).max(20).optional(),
    }).strict(),
  }).strict(),
}).strict();

export type InboxDareExpenseInput = z.infer<typeof inboxDareExpenseSchema>;

export function inboxDareExpenseFingerprint(input: InboxDareExpenseInput) {
  return createHash("sha256").update(JSON.stringify({
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentSha256: input.sourceAttachmentSha256,
    accountPlanId: input.accountPlanId,
    referenceResultCenterId: input.referenceResultCenterId,
    apportionments: [...input.apportionments].sort((left, right) => left.resultCenterId.localeCompare(right.resultCenterId)),
    documentConfirmation: input.documentConfirmation,
  })).digest("hex");
}
