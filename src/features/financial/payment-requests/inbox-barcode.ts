import { z } from "zod";

import { CnpjValidator } from "@/lib/company/cnpj-validator";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}, "Data de pagamento inválida.");

export const inboxBarcodePaymentPreparationSchema = z.object({
  scheduledFor: isoDate,
  barcode: z.string().trim().max(80).optional(),
  beneficiaryDocument: z.string()
    .transform((value) => CnpjValidator.clean(value))
    .refine((value) => CnpjValidator.validate(value).valid, "CNPJ do favorecido inválido."),
}).strict();

export type InboxBarcodePaymentPreparation = z.infer<typeof inboxBarcodePaymentPreparationSchema>;
