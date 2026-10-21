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
export const mobileInboxUploadCancelSchema = z.object({ submissionId: z.string().uuid("Identificador de envio inválido.") }).strict();
export type MobileInboxUploadCancel = z.infer<typeof mobileInboxUploadCancelSchema>;
export type MobilePurchasePaymentMethod = z.infer<typeof mobilePurchasePaymentMethodSchema>;

export type MobilePurchaseAnalysis = {
  /** Classificação fiscal das imagens da compra, independente do nome dado ao anexo. */
  purchaseDocumentKind: "nfe_or_danfe" | "nfce" | "coupon_or_receipt" | "unknown";
  purchaseDocumentKindConfidence: "high" | "medium" | "low";
  fiscalAuthorizationStatus: "authorized" | "pending" | "unknown";
  /** Trecho literal do documento que sustenta a autorização, quando houver. */
  fiscalAuthorizationEvidence: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  purchaseDate: string | null;
  amountCents: number | null;
  items: Array<{
    description: string; quantity: number | null; unit: string | null; unitPriceCents: number | null; totalCents: number | null;
    /** Produto de estoque sugerido e quantas embalagens dele a linha representa; a revisão humana confirma. */
    productId: string | null; packages: number | null;
    /** Destinação operacional sugerida pela IA, independente da situação financeira da compra. */
    aiTreatment: "existing_item" | "item_not_found" | "asset_candidate" | "immediate_use" | "needs_review";
    aiConfidence: "high" | "medium" | "low";
    aiReason: string | null;
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

/** Concordância de duas leituras isoladas; PDF ainda exige confronto com a camada textual. */
export type MobileFiscalVerification = {
  method: "dual_multimodal";
  pdfTextChecked: boolean;
  purchaseDocumentKind: "nfe_or_danfe" | "nfce";
  authorizationProtocol: string;
  receiptSha256s: string[];
};

export type IndependentMobileFiscalReading = {
  purchaseDocumentKind: MobilePurchaseAnalysis["purchaseDocumentKind"];
  purchaseDocumentKindConfidence: MobilePurchaseAnalysis["purchaseDocumentKindConfidence"];
  fiscalAuthorizationStatus: MobilePurchaseAnalysis["fiscalAuthorizationStatus"];
  fiscalAuthorizationEvidence: string | null;
  authorizationProtocol: string | null;
};

export type MobilePurchaseAttachment = {
  filename?: string | null;
  contentType?: string | null;
  archiveStatus?: string | null;
  sha256?: string | null;
};

export function storedMobilePurchaseAttachmentState(attachments: MobilePurchaseAttachment[]) {
  return {
    hasPurchaseDocument: attachments.some((attachment) => String(attachment.filename ?? "").startsWith("receipt-") && attachment.archiveStatus === "stored"),
    hasPaymentProof: attachments.some((attachment) => String(attachment.filename ?? "").startsWith("payment-proof-") && attachment.archiveStatus === "stored"),
  };
}

function fiscalEvidenceText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const PENDING_FISCAL_AUTHORIZATION = /contingenc.{0,80}pendente|pendente.{0,80}autoriz|aguardando.{0,80}autoriz|rejeitad|nao autorizad/;

/** O marcador textual não é uma consulta à SEFAZ; exige protocolo numérico e falha se houver sinal de invalidez. */
export function fiscalAuthorizationProtocol(text: string): string | null {
  const normalized = fiscalEvidenceText(text).replace(/\s+/g, " ");
  if (PENDING_FISCAL_AUTHORIZATION.test(normalized)
    || /cancelad|denegad|inutilizad|sem valor fiscal|autorizacao pendente/.test(normalized)) return null;
  const protocol = normalized.match(/protocolo\s+(?:de\s+)?autorizacao(?:\s+de\s+uso)?\s*[:#.–-]?\s*((?:\d[\s.\-]*){15,18})/);
  const digits = protocol?.[1]?.replace(/\D/g, "") ?? "";
  return digits.length === 15 ? digits : null;
}

export function fiscalAuthorizationFromPdfText(text: string): Pick<MobileFiscalVerification, "purchaseDocumentKind" | "authorizationProtocol"> | null {
  const normalized = fiscalEvidenceText(text).replace(/\s+/g, " ");
  if (PENDING_FISCAL_AUTHORIZATION.test(normalized)
    || /cancelad|denegad|inutilizad|sem valor fiscal|autorizacao pendente/.test(normalized)) return null;
  const kind = /\bnfc\s*[-–]?\s*e\b|nota fiscal de consumidor eletronic|danfe\s+nfc/.test(normalized)
    ? "nfce" : /\bnf\s*[-–]?\s*e\b|nota fiscal eletronic|\bdanfe\b/.test(normalized)
      ? "nfe_or_danfe" : null;
  if (!kind) return null;
  const digits = fiscalAuthorizationProtocol(normalized);
  return digits ? { purchaseDocumentKind: kind, authorizationProtocol: digits } : null;
}

export function normalizeMobileFiscalDocument(raw: Record<string, unknown>): Pick<MobilePurchaseAnalysis, "purchaseDocumentKind" | "purchaseDocumentKindConfidence" | "fiscalAuthorizationStatus" | "fiscalAuthorizationEvidence"> {
  const kind = raw.purchaseDocumentKind;
  const confidence = raw.purchaseDocumentKindConfidence;
  const status = raw.fiscalAuthorizationStatus;
  const evidence = typeof raw.fiscalAuthorizationEvidence === "string" && raw.fiscalAuthorizationEvidence.trim()
    ? raw.fiscalAuthorizationEvidence.trim() : null;
  return {
    purchaseDocumentKind: kind === "nfe_or_danfe" || kind === "nfce" || kind === "coupon_or_receipt" ? kind : "unknown",
    purchaseDocumentKindConfidence: confidence === "high" || confidence === "medium" ? confidence : "low",
    fiscalAuthorizationStatus: evidence && PENDING_FISCAL_AUTHORIZATION.test(fiscalEvidenceText(evidence))
      ? "pending" : status === "authorized" || status === "pending" ? status : "unknown",
    fiscalAuthorizationEvidence: evidence?.slice(0, 240) ?? null,
  };
}

export function mobilePurchaseMayOmitPaymentProof(
  analysis: Pick<MobilePurchaseAnalysis, "purchaseDocumentKind" | "purchaseDocumentKindConfidence" | "fiscalAuthorizationStatus" | "fiscalAuthorizationEvidence"> | null | undefined,
  check: MobileFiscalVerification | null | undefined,
  attachments: MobilePurchaseAttachment[],
): boolean {
  if (!check || check.method !== "dual_multimodal" || !/^\d{15}$/.test(check.authorizationProtocol)
    || !Array.isArray(check.receiptSha256s) || !check.receiptSha256s.length
    || check.receiptSha256s.some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) return false;
  const receipts = attachments.filter((attachment) => String(attachment.filename ?? "").startsWith("receipt-"));
  if (receipts.length !== check.receiptSha256s.length
    || (receipts.some((attachment) => attachment.contentType === "application/pdf") && check.pdfTextChecked !== true)
    || receipts.some((attachment) => attachment.archiveStatus !== "stored" || !/^[a-f0-9]{64}$/.test(String(attachment.sha256 ?? "")))) return false;
  const actualHashes = receipts.map((attachment) => String(attachment.sha256)).sort();
  const checkedHashes = [...check.receiptSha256s].sort();
  if (actualHashes.some((hash, index) => hash !== checkedHashes[index])) return false;
  return (check.purchaseDocumentKind === "nfe_or_danfe" || check.purchaseDocumentKind === "nfce")
    && analysis?.purchaseDocumentKind === check.purchaseDocumentKind
    && analysis.purchaseDocumentKindConfidence === "high"
    && analysis.fiscalAuthorizationStatus === "authorized"
    && fiscalAuthorizationProtocol(analysis.fiscalAuthorizationEvidence ?? "") === check.authorizationProtocol;
}

export function verifyMobileFiscalReadings(
  primary: Pick<MobilePurchaseAnalysis, "purchaseDocumentKind" | "purchaseDocumentKindConfidence" | "fiscalAuthorizationStatus" | "fiscalAuthorizationEvidence"> | null,
  independent: IndependentMobileFiscalReading | null,
  pdfTextChecks: Array<Pick<MobileFiscalVerification, "purchaseDocumentKind" | "authorizationProtocol"> | null>,
  receiptSha256s: string[],
): MobileFiscalVerification | null {
  const protocol = fiscalAuthorizationProtocol(primary?.fiscalAuthorizationEvidence ?? "");
  if (!primary || !independent || !protocol || !receiptSha256s.length
    || primary.purchaseDocumentKindConfidence !== "high" || primary.fiscalAuthorizationStatus !== "authorized"
    || independent.purchaseDocumentKindConfidence !== "high" || independent.fiscalAuthorizationStatus !== "authorized"
    || (primary.purchaseDocumentKind !== "nfe_or_danfe" && primary.purchaseDocumentKind !== "nfce")
    || primary.purchaseDocumentKind !== independent.purchaseDocumentKind
    || independent.authorizationProtocol !== protocol
    || fiscalAuthorizationProtocol(independent.fiscalAuthorizationEvidence ?? "") !== protocol
    || pdfTextChecks.some((check) => !check || check.purchaseDocumentKind !== primary.purchaseDocumentKind || check.authorizationProtocol !== protocol)) return null;
  return { method: "dual_multimodal", pdfTextChecked: pdfTextChecks.length > 0,
    purchaseDocumentKind: primary.purchaseDocumentKind, authorizationProtocol: protocol, receiptSha256s };
}

export function mobileFiscalAuthorizationWarnings(warnings: string[], status: MobilePurchaseAnalysis["fiscalAuthorizationStatus"]): string[] {
  if (status !== "pending") return warnings.slice(0, 10);
  const pendingWarning = "Documento fiscal pendente de autorização; confirme sua validade fiscal antes de tratá-lo como definitivo.";
  return [pendingWarning, ...warnings.filter((warning) => warning !== pendingWarning)].slice(0, 10);
}

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
