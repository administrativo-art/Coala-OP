import "server-only";

import { getStorage } from "firebase-admin/storage";

import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { extractFinancialDocument, FINANCIAL_DOCUMENT_EXTRACTION_VERSION } from "./document-extraction.server";
import { archiveFinancialInboxLinkedDocuments } from "./linked-document-resolver.server";
import type { FinancialInboxAttachment, FinancialInboxDocumentHints, FinancialInboxMessage } from "./types";

const MAX_DOCUMENTS_TO_ANALYZE = 5;
const MAX_COMBINED_TEXT = 120_000;

function textSidecarPath(attachment: FinancialInboxAttachment) {
  const storagePath = attachment.storagePath || "";
  return `${storagePath}.extracted-${FINANCIAL_DOCUMENT_EXTRACTION_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`;
}

async function loadStorageBuffer(path: string) {
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download();
  return buffer;
}

async function existingExtractedText(attachment: FinancialInboxAttachment) {
  if (attachment.extractionVersion !== FINANCIAL_DOCUMENT_EXTRACTION_VERSION
    || !attachment.extractedTextStoragePath
    || !["extracted", "ocr_extracted"].includes(attachment.extractionStatus ?? "")) return null;
  try {
    return (await loadStorageBuffer(attachment.extractedTextStoragePath)).toString("utf8").slice(0, MAX_COMBINED_TEXT);
  } catch {
    return null;
  }
}

async function processAttachment(
  attachment: FinancialInboxAttachment,
  message: FinancialInboxMessage,
) {
  if (attachment.archiveStatus !== "stored" || !attachment.storagePath) {
    return { attachment, text: "", hints: null as FinancialInboxDocumentHints | null };
  }
  const cachedText = await existingExtractedText(attachment);
  if (cachedText != null) return { attachment, text: cachedText, hints: attachment.extractedHints ?? null };
  const buffer = await loadStorageBuffer(attachment.storagePath);
  const extraction = await extractFinancialDocument({
    buffer,
    filename: attachment.filename,
    contentType: attachment.contentType,
    subject: message.subject,
    senderDomain: message.senderDomain,
  });
  const extractedAt = new Date().toISOString();
  let extractedTextStoragePath: string | null = null;
  if (extraction.text) {
    extractedTextStoragePath = textSidecarPath(attachment);
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(extractedTextStoragePath).save(
      Buffer.from(extraction.text, "utf8"),
      {
        resumable: false,
        metadata: { contentType: "text/plain; charset=utf-8", cacheControl: "private, no-store" },
      },
    );
  }
  const processed: FinancialInboxAttachment = {
    ...attachment,
    sourceType: attachment.sourceType ?? "attachment",
    extractionStatus: extraction.status,
    extractionMethod: extraction.method,
    extractionVersion: FINANCIAL_DOCUMENT_EXTRACTION_VERSION,
    extractedTextStoragePath,
    extractedAt,
    pageCount: extraction.pageCount,
    extractedHints: extraction.hints,
  };
  return { attachment: processed, text: extraction.text, hints: extraction.hints };
}

export async function prepareFinancialInboxDocuments(message: FinancialInboxMessage) {
  const linked = await archiveFinancialInboxLinkedDocuments(message);
  const sourceAttachments = linked.attachments;
  const results: Array<{ attachment: FinancialInboxAttachment; text: string; hints: FinancialInboxDocumentHints | null }> = [];
  let analyzedDocuments = 0;
  for (let index = 0; index < sourceAttachments.length; index += 1) {
    const attachment = sourceAttachments[index];
    if (attachment.archiveStatus !== "stored" || !attachment.storagePath) {
      results.push({ attachment, text: "", hints: attachment.extractedHints ?? null });
      continue;
    }
    if (analyzedDocuments >= MAX_DOCUMENTS_TO_ANALYZE) {
      results.push({ attachment, text: "", hints: attachment.extractedHints ?? null });
      continue;
    }
    analyzedDocuments += 1;
    try {
      results.push(await processAttachment(attachment, message));
    } catch {
      results.push({
        attachment: {
          ...attachment,
          sourceType: attachment.sourceType ?? "attachment",
          extractionStatus: "failed",
          extractionMethod: null,
          extractionVersion: FINANCIAL_DOCUMENT_EXTRACTION_VERSION,
          extractedAt: new Date().toISOString(),
        },
        text: "",
        hints: null,
      });
    }
  }
  const attachments = results.map((result) => result.attachment);
  const documentText = results.map((result) => result.text).filter(Boolean).join("\n\n").slice(0, MAX_COMBINED_TEXT);
  const hints = results.map((result) => result.hints).filter((hint): hint is FinancialInboxDocumentHints => Boolean(hint));
  const extractionFailures = attachments.filter((attachment) => attachment.extractionStatus === "failed").length;
  const needsOcr = attachments.filter((attachment) => attachment.extractionStatus === "needs_ocr").length;
  const warnings = [
    ...(extractionFailures ? [`Não foi possível analisar ${extractionFailures} documento(s) arquivado(s).`] : []),
    ...(needsOcr ? [`${needsOcr} documento(s) exige(m) OCR; configure a análise documental para continuar.`] : []),
  ];
  return {
    attachments,
    documentText,
    hints,
    linkResolution: linked.resolution,
    warnings,
  };
}
