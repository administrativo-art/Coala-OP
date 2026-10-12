import "server-only";

import { renderSystemPrompt } from "@/ai/prompts/registry";
import type { DetectedMobileInboxFile, MobileInboxUploadMetadata, MobilePurchaseAnalysis, MobilePurchasePaymentMethod } from "./mobile-upload";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";

const PAYMENT_METHODS = new Set<MobilePurchasePaymentMethod>(["pix", "card_credit", "card_debit", "cash", "boleto", "term", "unknown"]);
const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplierName", "supplierTaxId", "purchaseDate", "amountCents", "items", "confidence", "suggestedAccountId", "payment", "warnings"],
  properties: {
    suggestedAccountId: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    supplierTaxId: { type: ["string", "null"] },
    purchaseDate: { type: ["string", "null"] },
    amountCents: { type: ["integer", "null"] },
    items: {
      type: "array", maxItems: 100, items: {
        type: "object", additionalProperties: false,
        required: ["description", "quantity", "unit", "unitPriceCents", "totalCents", "productId", "packages"],
        properties: {
          productId: { type: ["string", "null"] }, packages: { type: ["number", "null"] },
          description: { type: "string" }, quantity: { type: ["number", "null"] }, unit: { type: ["string", "null"] },
          unitPriceCents: { type: ["integer", "null"] }, totalCents: { type: ["integer", "null"] },
        },
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    payment: {
      type: ["object", "null"], additionalProperties: false,
      required: ["method", "amountCents", "paidAt", "payeeName", "transactionId", "confidence", "amountMatchesReceipt", "payeeMatchesSupplier"],
      properties: {
        method: { type: "string", enum: [...PAYMENT_METHODS] }, amountCents: { type: ["integer", "null"] },
        paidAt: { type: ["string", "null"] }, payeeName: { type: ["string", "null"] }, transactionId: { type: ["string", "null"] },
        confidence: { type: "string", enum: ["high", "medium", "low"] }, amountMatchesReceipt: { type: ["boolean", "null"] },
        payeeMatchesSupplier: { type: ["boolean", "null"] },
      },
    },
    warnings: { type: "array", maxItems: 10, items: { type: "string" } },
  },
} as const;

type PurchaseAccount = { id: string; name: string };
type PurchaseProduct = { id: string; name: string; packageLabel: string };
type InputDocument = { buffer: Buffer; filename: string; detected: DetectedMobileInboxFile };

function shortString(value: unknown, max = 300) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isoDate(value: unknown) {
  const text = shortString(value, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cents(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function companyTaxId(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 14 ? digits : null;
}

function confidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" ? value : "low";
}

function normalize(value: unknown, fundingSource: MobileInboxUploadMetadata["fundingSource"], accounts: PurchaseAccount[], products: PurchaseProduct[]): MobilePurchaseAnalysis {
  const productIds = new Set(products.map((product) => product.id));
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const paymentRaw = raw.payment && typeof raw.payment === "object" && !Array.isArray(raw.payment) ? raw.payment as Record<string, unknown> : null;
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((entry) => {
    const item = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    const description = shortString(item?.description, 180);
    if (!item || !description) return [];
    const quantity = Number(item.quantity);
    const packages = Number(item.packages);
    // As with the category, only an id from the offered catalog survives.
    const productId = typeof item.productId === "string" && productIds.has(item.productId) ? item.productId : null;
    return [{
      productId,
      packages: productId && Number.isFinite(packages) && packages > 0 ? packages : null,
      description,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      unit: shortString(item.unit, 30),
      unitPriceCents: cents(item.unitPriceCents),
      totalCents: cents(item.totalCents),
    }];
  }).slice(0, 100);
  const method = PAYMENT_METHODS.has(paymentRaw?.method as MobilePurchasePaymentMethod) ? paymentRaw!.method as MobilePurchasePaymentMethod : "unknown";
  return {
    supplierName: shortString(raw.supplierName, 240),
    supplierTaxId: companyTaxId(raw.supplierTaxId),
    purchaseDate: isoDate(raw.purchaseDate),
    amountCents: cents(raw.amountCents),
    items,
    confidence: confidence(raw.confidence),
    // Only an id from the offered list survives; anything else the model writes is discarded.
    suggestedAccountId: accounts.find((account) => account.id === raw.suggestedAccountId)?.id ?? null,
    payment: fundingSource === "cash_withdrawal" ? null : {
      method,
      amountCents: cents(paymentRaw?.amountCents),
      paidAt: isoDate(paymentRaw?.paidAt),
      payeeName: shortString(paymentRaw?.payeeName, 240),
      transactionId: shortString(paymentRaw?.transactionId, 120),
      confidence: confidence(paymentRaw?.confidence),
      amountMatchesReceipt: typeof paymentRaw?.amountMatchesReceipt === "boolean" ? paymentRaw.amountMatchesReceipt : null,
      payeeMatchesSupplier: typeof paymentRaw?.payeeMatchesSupplier === "boolean" ? paymentRaw.payeeMatchesSupplier : null,
    },
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).flatMap((warning) => shortString(warning, 240) ? [shortString(warning, 240)!] : []).slice(0, 10),
  };
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output || []).flatMap((entry: any) => entry?.content || []).map((entry: any) => entry?.text).filter((entry: unknown): entry is string => typeof entry === "string").join("\n");
}

async function uploadFile(document: InputDocument, apiKey: string) {
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", new File([new Uint8Array(document.buffer)], document.filename, { type: document.detected.contentType }), document.filename);
  const response = await fetch(OPENAI_FILES_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(45_000) });
  const payload = await response.json() as { id?: string };
  if (!response.ok || !payload.id) throw new Error("OPENAI_MOBILE_PURCHASE_FILE_UPLOAD_FAILED");
  return payload.id;
}

async function deleteFile(fileId: string, apiKey: string) {
  await fetch(`${OPENAI_FILES_URL}/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
}

export async function extractMobilePurchaseDocuments(params: {
  metadata: MobileInboxUploadMetadata;
  receipts: InputDocument[];
  paymentProofs: InputDocument[];
  accounts: PurchaseAccount[];
  products: PurchaseProduct[];
}): Promise<MobilePurchaseAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const uploadedFileIds: string[] = [];
  try {
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: renderSystemPrompt("financial.mobile-purchase-extraction", { fundingSource: params.metadata.fundingSource, accounts: params.accounts, products: params.products }) }];
    // Every page travels in the same request: one analysis per purchase, however many photos it took.
    const labelled = ([["NOTA DE COMPRA", params.receipts], ["COMPROVANTE DE PAGAMENTO", params.paymentProofs]] as const)
      .flatMap(([label, documents]) => documents.map((document, index) => ({
        label: documents.length > 1 ? `${label} — imagem ${index + 1} de ${documents.length} do mesmo documento` : label,
        document,
      })));
    for (const { label, document } of labelled) {
      content.push({ type: "input_text", text: label });
      if (document.detected.contentType.startsWith("image/")) {
        content.push({ type: "input_image", image_url: `data:${document.detected.contentType};base64,${document.buffer.toString("base64")}`, detail: "high" });
      } else {
        const fileId = await uploadFile(document, apiKey); uploadedFileIds.push(fileId); content.push({ type: "input_file", file_id: fileId });
      }
    }
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MOBILE_RECEIPT_MODEL?.trim() || "gpt-5-mini",
        store: false,
        input: [{ role: "user", content }],
        max_output_tokens: 4000,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "mobile_purchase", strict: true, schema: ANALYSIS_SCHEMA } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json() as any;
    if (!response.ok) throw new Error("OPENAI_MOBILE_PURCHASE_EXTRACTION_FAILED");
    return normalize(JSON.parse(outputText(payload)), params.metadata.fundingSource, params.accounts, params.products);
  } finally {
    await Promise.all(uploadedFileIds.map((fileId) => deleteFile(fileId, apiKey)));
  }
}
