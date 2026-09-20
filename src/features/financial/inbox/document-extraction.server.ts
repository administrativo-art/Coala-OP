import "server-only";

import { getActiveSystemPrompt, renderSystemPrompt } from "@/ai/prompts/registry";
import { classifyFinancialEmail, normalizeBrazilianServiceNumber, normalizePaymentBarcode } from "./parser";
import { extractDeterministicFinancialDocumentText, isImageDocument, isPdfDocument } from "./document-text";
import type {
  FinancialInboxDocumentHints,
  FinancialInboxFiscalDocumentKind,
  FinancialInboxFiscalIdentity,
  FinancialInboxServiceType,
} from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";
const PROMPT = getActiveSystemPrompt("financial.inbox-document-extraction");

export const FINANCIAL_DOCUMENT_EXTRACTION_VERSION = `${PROMPT.version}:pdfjs-v1`;
const MAX_EXTRACTED_TEXT = 80_000;

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "documentText", "supplierName", "supplierTaxId", "competence", "dueDate", "amountCents",
    "barcode", "customerAccount", "contractNumber", "serviceType", "serviceNumbers", "fiscalIdentity", "confidence",
  ],
  properties: {
    documentText: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    supplierTaxId: { type: ["string", "null"] },
    competence: { type: ["string", "null"] },
    dueDate: { type: ["string", "null"] },
    amountCents: { type: ["integer", "null"] },
    barcode: { type: ["string", "null"] },
    customerAccount: { type: ["string", "null"] },
    contractNumber: { type: ["string", "null"] },
    serviceType: { type: ["string", "null"], enum: ["mobile", "landline", "internet", "energy", "water", "other", null] },
    serviceNumbers: { type: "array", items: { type: "string" }, maxItems: 20 },
    fiscalIdentity: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "documentKind", "collectorName", "taxpayerName", "taxpayerTaxId", "taxpayerRegistration",
        "documentNumber", "revenueCodes", "revenueDescriptions", "revenueItems",
      ],
      properties: {
        documentKind: { type: "string", enum: ["das", "darf", "dctfweb", "dare", "fgts", "municipal_tax", "other"] },
        collectorName: { type: ["string", "null"] },
        taxpayerName: { type: ["string", "null"] },
        taxpayerTaxId: { type: ["string", "null"] },
        taxpayerRegistration: { type: ["string", "null"] },
        documentNumber: { type: ["string", "null"] },
        revenueCodes: { type: "array", items: { type: "string" }, maxItems: 20 },
        revenueDescriptions: { type: "array", items: { type: "string" }, maxItems: 20 },
        revenueItems: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "description", "amountCents"],
            properties: {
              code: { type: ["string", "null"] },
              description: { type: "string" },
              amountCents: { type: ["integer", "null"] },
            },
          },
        },
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
} as const;

export type FinancialDocumentExtraction = {
  status: "extracted" | "ocr_extracted" | "needs_ocr" | "empty" | "unsupported" | "failed";
  method: "pdf_text" | "xml_text" | "plain_text" | "ai_document" | null;
  text: string;
  pageCount: number | null;
  hints: FinancialInboxDocumentHints | null;
};

function shortString(value: unknown, max = 300) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function date(value: unknown) {
  const normalized = shortString(value, 10);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function competence(value: unknown) {
  const normalized = shortString(value, 7);
  return normalized && /^\d{4}-\d{2}$/.test(normalized) ? normalized : null;
}

function taxId(value: unknown) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length === 14 ? normalized : null;
}

function personTaxId(value: unknown) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length === 11 || normalized.length === 14 ? normalized : null;
}

function fiscalDocumentKind(value: unknown): FinancialInboxFiscalDocumentKind | null {
  return ["das", "darf", "dctfweb", "dare", "fgts", "municipal_tax", "other"].includes(String(value))
    ? value as FinancialInboxFiscalDocumentKind
    : null;
}

function shortStringArray(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => shortString(entry, 180))
    .filter((entry): entry is string => Boolean(entry)))].slice(0, 20);
}

function normalizeFiscalIdentity(value: unknown): FinancialInboxFiscalIdentity | null {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const documentKind = fiscalDocumentKind(raw?.documentKind);
  if (!raw || !documentKind) return null;
  const revenueItems = (Array.isArray(raw.revenueItems) ? raw.revenueItems : []).flatMap((entry) => {
    const item = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    const description = shortString(item?.description, 180);
    if (!item || !description) return [];
    const amount = Number(item.amountCents);
    return [{
      code: shortString(item.code, 40),
      description,
      amountCents: Number.isInteger(amount) && amount >= 0 ? amount : null,
    }];
  }).slice(0, 20);
  return {
    documentKind,
    collectorName: shortString(raw.collectorName),
    taxpayerName: shortString(raw.taxpayerName),
    taxpayerTaxId: personTaxId(raw.taxpayerTaxId),
    taxpayerRegistration: shortString(raw.taxpayerRegistration, 80),
    documentNumber: shortString(raw.documentNumber, 80),
    revenueCodes: shortStringArray(raw.revenueCodes),
    revenueDescriptions: shortStringArray(raw.revenueDescriptions),
    revenueItems,
  };
}

function serviceType(value: unknown): FinancialInboxServiceType | null {
  return ["mobile", "landline", "internet", "energy", "water", "other"].includes(String(value))
    ? value as FinancialInboxServiceType
    : null;
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output || [])
    .flatMap((entry: any) => entry?.content || [])
    .map((entry: any) => entry?.text)
    .filter((entry: unknown): entry is string => typeof entry === "string")
    .join("\n");
}

function normalizeAiHints(value: unknown): FinancialInboxDocumentHints {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const amount = Number(raw.amountCents);
  return {
    documentText: shortString(raw.documentText, 12_000),
    supplierName: shortString(raw.supplierName),
    supplierTaxId: taxId(raw.supplierTaxId),
    competence: competence(raw.competence),
    dueDate: date(raw.dueDate),
    amountCents: Number.isInteger(amount) && amount > 0 ? amount : null,
    barcode: normalizePaymentBarcode(String(raw.barcode ?? "")),
    customerAccount: shortString(raw.customerAccount, 80),
    contractNumber: shortString(raw.contractNumber, 80),
    serviceType: serviceType(raw.serviceType),
    serviceNumbers: [...new Set((Array.isArray(raw.serviceNumbers) ? raw.serviceNumbers : [])
      .map(normalizeBrazilianServiceNumber)
      .filter((entry): entry is string => Boolean(entry)))].slice(0, 20),
    fiscalIdentity: normalizeFiscalIdentity(raw.fiscalIdentity),
    confidence: raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low",
  };
}

async function uploadOpenAiFile(buffer: Buffer, filename: string, contentType: string, apiKey: string) {
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", new File([new Uint8Array(buffer)], filename, { type: contentType }), filename);
  const response = await fetch(OPENAI_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json() as { id?: string };
  if (!response.ok || !payload.id) throw new Error("OPENAI_FILE_UPLOAD_FAILED");
  return payload.id;
}

async function deleteOpenAiFile(fileId: string, apiKey: string) {
  await fetch(`${OPENAI_FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

async function extractWithAi(params: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  subject: string;
  senderDomain: string | null;
  deterministicText: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const prompt = renderSystemPrompt("financial.inbox-document-extraction", {
    emailSubject: params.subject,
    senderDomain: params.senderDomain,
    deterministicText: params.deterministicText || null,
  });
  let fileId: string | null = null;
  try {
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    if (isImageDocument(params.contentType, params.filename)) {
      content.unshift({
        type: "input_image",
        image_url: `data:${params.contentType};base64,${params.buffer.toString("base64")}`,
        detail: "high",
      });
    } else if (isPdfDocument(params.contentType, params.filename)) {
      fileId = await uploadOpenAiFile(params.buffer, params.filename, params.contentType, apiKey);
      content.unshift({ type: "input_file", file_id: fileId });
    }
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_FINANCIAL_INBOX_DOCUMENT_MODEL || process.env.OPENAI_FINANCIAL_DOCUMENT_MODEL || "gpt-5.6-terra",
        store: false,
        input: [{ role: "user", content }],
        max_output_tokens: 5000,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "financial_inbox_document", strict: true, schema: EXTRACTION_SCHEMA } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json() as any;
    if (!response.ok) throw new Error("OPENAI_DOCUMENT_EXTRACTION_FAILED");
    return normalizeAiHints(JSON.parse(outputText(payload)));
  } finally {
    if (fileId) await deleteOpenAiFile(fileId, apiKey);
  }
}

function shouldUseAi(params: { text: string; subject: string; senderDomain: string | null }) {
  if (params.text.trim().length < 80) return true;
  const parsed = classifyFinancialEmail({
    subject: params.subject,
    text: "",
    senderDomain: params.senderDomain,
    documentText: params.text,
  }).classification;
  const identity = parsed.billingIdentity;
  const telecomIncomplete = (identity?.serviceType === "mobile" || identity?.serviceType === "landline")
    && !identity.serviceNumbers.length;
  const fiscal = parsed.fiscalIdentity;
  const fiscalIncomplete = Boolean(fiscal && (
    !fiscal.collectorName
    || !fiscal.taxpayerTaxId
    || !fiscal.documentNumber
    || fiscal.revenueDescriptions.length === 0
    || fiscal.revenueItems.length === 0
  ));
  return !parsed.amountCents || !parsed.dueDate || !parsed.competence || telecomIncomplete || fiscalIncomplete;
}

export async function extractFinancialDocument(params: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  subject: string;
  senderDomain: string | null;
}): Promise<FinancialDocumentExtraction> {
  try {
    const deterministic = await extractDeterministicFinancialDocumentText(params);
    let text = deterministic.text;
    const pageCount = deterministic.pageCount;
    const deterministicMethod: FinancialDocumentExtraction["method"] = deterministic.method;
    if (!deterministic.supported) {
      return { status: "unsupported", method: null, text: "", pageCount: null, hints: null };
    }

    const useAi = isImageDocument(params.contentType, params.filename) || shouldUseAi({
      text,
      subject: params.subject,
      senderDomain: params.senderDomain,
    });
    if (useAi) {
      const hints = await extractWithAi({ ...params, deterministicText: text }).catch(() => null);
      if (hints) {
        const combinedText = [text, hints.documentText].filter(Boolean).join("\n\n").slice(0, MAX_EXTRACTED_TEXT);
        return { status: "ocr_extracted", method: "ai_document", text: combinedText, pageCount, hints };
      }
      if (!text) return { status: "needs_ocr", method: null, text: "", pageCount, hints: null };
    }
    if (!text) return { status: "empty", method: deterministicMethod, text: "", pageCount, hints: null };
    return { status: "extracted", method: deterministicMethod, text, pageCount, hints: null };
  } catch {
    return { status: "failed", method: null, text: "", pageCount: null, hints: null };
  }
}
