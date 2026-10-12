import { createHash } from "node:crypto";

import { z } from "zod";

export const MOBILE_INBOX_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const MOBILE_INBOX_UPLOAD_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/** Nota longa ou frente e verso: até duas imagens por papel, ainda um único documento lógico. */
export const MOBILE_INBOX_UPLOAD_MAX_FILES_PER_ROLE = 2;

export const mobilePurchaseFundingSourceSchema = z.enum(["cash_withdrawal", "company_payment"]);
export const mobilePurchasePaymentMethodSchema = z.enum(["pix", "card_credit", "card_debit", "cash", "boleto", "term", "unknown"]);

export const mobileInboxUploadMetadataSchema = z.object({
  submissionId: z.string().uuid("Identificador de envio inválido."),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(240, "A observação deve ter no máximo 240 caracteres.").optional(),
  fundingSource: mobilePurchaseFundingSourceSchema,
}).strict();

export type MobileInboxUploadMetadata = z.infer<typeof mobileInboxUploadMetadataSchema>;
export type MobilePurchasePaymentMethod = z.infer<typeof mobilePurchasePaymentMethodSchema>;

export type MobilePurchaseAnalysis = {
  supplierName: string | null;
  supplierTaxId: string | null;
  purchaseDate: string | null;
  amountCents: number | null;
  items: Array<{
    description: string; quantity: number | null; unit: string | null; unitPriceCents: number | null; totalCents: number | null;
    /** Produto de estoque sugerido e quantas embalagens dele a linha representa; a revisão humana confirma. */
    productId: string | null; packages: number | null;
  }>;
  confidence: "high" | "medium" | "low";
  /** Categoria sugerida pela IA entre as contas liberadas; a revisão humana confirma ou troca. */
  suggestedAccountId: string | null;
  payment: null | {
    method: MobilePurchasePaymentMethod;
    amountCents: number | null;
    paidAt: string | null;
    payeeName: string | null;
    transactionId: string | null;
    confidence: "high" | "medium" | "low";
    amountMatchesReceipt: boolean | null;
    payeeMatchesSupplier: boolean | null;
  };
  warnings: string[];
};

export type DetectedMobileInboxFile = {
  extension: "jpg" | "png" | "webp" | "pdf";
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
};

export function detectMobileInboxFile(buffer: Buffer): DetectedMobileInboxFile | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", contentType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { extension: "pdf", contentType: "application/pdf" };
  }
  return null;
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

export function mobileInboxDocumentId(workspaceId: string, submissionId: string) {
  return `mobile_${sha256(`${workspaceId}:${submissionId}`).slice(0, 40)}`;
}
