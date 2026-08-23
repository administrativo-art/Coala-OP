import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

import { classifyFinancialEmail, extractEmailAddress } from "./parser";
import type { FinancialInboxAttachment, FinancialInboxMessage } from "./types";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { WORKSPACE_ID } from "@/lib/workspace";

const RESEND_API_URL = "https://api.resend.com/emails/receiving";
const MAX_RAW_BYTES = 35 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

type ResendAttachment = {
  id?: string;
  filename?: string;
  content_type?: string;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number;
};

export type ResendReceivedEmail = {
  id?: string;
  to?: string[];
  from?: string;
  created_at?: string;
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string>;
  received_for?: string[];
  message_id?: string | null;
  raw?: { download_url?: string; expires_at?: string } | null;
  attachments?: ResendAttachment[];
};

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 160) || "arquivo";
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isAllowedResendDownload(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "resend.com"
      || hostname.endsWith(".resend.com")
      || hostname === "cloudfront.net"
      || hostname.endsWith(".cloudfront.net");
  } catch {
    return false;
  }
}

async function downloadBuffer(rawUrl: string, maxBytes: number) {
  if (!isAllowedResendDownload(rawUrl)) throw new Error("O Resend retornou um endereço de arquivo não permitido.");
  const response = await fetch(rawUrl, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Falha ao arquivar arquivo recebido (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("O arquivo recebido excede o limite de arquivamento.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error("O arquivo recebido excede o limite de arquivamento.");
  return buffer;
}

function isAllowedAttachment(contentType: string, filename: string) {
  const normalizedType = contentType.toLowerCase();
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const allowedGenericExtensions = new Set(["pdf", "xml", "csv", "txt", "eml", "png", "jpg", "jpeg", "webp", "gif"]);
  const knownSafeType = normalizedType === "application/pdf"
    || normalizedType === "application/xml"
    || normalizedType === "text/xml"
    || normalizedType === "text/csv"
    || normalizedType === "text/plain"
    || normalizedType === "message/rfc822"
    || allowedImageTypes.has(normalizedType);
  const genericSafeType = normalizedType === "application/octet-stream" || normalizedType === "application/force-download";
  return knownSafeType || (genericSafeType && allowedGenericExtensions.has(extension));
}

export function isFinancialInboundRecipient(recipients: string[]) {
  const configured = process.env.FINANCIAL_INBOUND_ADDRESS?.trim().toLowerCase();
  if (!configured) return false;
  return recipients.some((recipient) => recipient.trim().toLowerCase() === configured);
}

export async function retrieveReceivedEmail(emailId: string, apiKey: string) {
  const response = await fetch(`${RESEND_API_URL}/${encodeURIComponent(emailId)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as ResendReceivedEmail;
  if (!response.ok) throw new Error("Falha ao obter o conteúdo do e-mail recebido.");
  return payload;
}

async function retrieveAttachmentDownload(emailId: string, attachmentId: string, apiKey: string) {
  const response = await fetch(`${RESEND_API_URL}/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as { download_url?: string };
  if (!response.ok || !payload.download_url) throw new Error("Falha ao obter anexo do e-mail recebido.");
  return payload.download_url;
}

async function archiveAttachment(params: {
  emailId: string;
  attachment: ResendAttachment;
  apiKey: string;
  basePath: string;
}): Promise<FinancialInboxAttachment> {
  const id = String(params.attachment.id || "").trim();
  const filename = safeFileName(String(params.attachment.filename || "arquivo"));
  const contentType = String(params.attachment.content_type || "application/octet-stream");
  const size = Math.max(0, Number(params.attachment.size) || 0);
  const contentDisposition = params.attachment.content_disposition ?? null;
  const base = { id, filename, contentType, size, contentDisposition };
  if (contentDisposition === "inline") return { ...base, storagePath: null, sha256: null, archiveStatus: "skipped_inline" };
  if (!id || !isAllowedAttachment(contentType, filename)) return { ...base, storagePath: null, sha256: null, archiveStatus: "skipped_unsafe" };
  if (size > MAX_ATTACHMENT_BYTES) return { ...base, storagePath: null, sha256: null, archiveStatus: "skipped_size" };

  try {
    const downloadUrl = await retrieveAttachmentDownload(params.emailId, id, params.apiKey);
    const buffer = await downloadBuffer(downloadUrl, MAX_ATTACHMENT_BYTES);
    const hash = sha256(buffer);
    const storagePath = `${params.basePath}/attachments/${safeId(id)}-${filename}`;
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "private, no-store",
        metadata: { sha256: hash, providerEmailId: params.emailId },
      },
    });
    return { ...base, size: buffer.byteLength, storagePath, sha256: hash, archiveStatus: "stored" };
  } catch {
    return { ...base, storagePath: null, sha256: null, archiveStatus: "failed" };
  }
}

function isAlreadyExists(error: unknown) {
  const code = (error as { code?: number | string })?.code;
  return code === 6 || code === "already-exists" || String((error as Error)?.message).includes("ALREADY_EXISTS");
}

export async function ingestFinancialEmail(params: {
  eventId: string;
  eventAt: string;
  emailId: string;
  apiKey: string;
  received?: ResendReceivedEmail;
}) {
  const documentId = safeId(params.emailId);
  const reference = financialDbAdmin.collection("financialInboxMessages").doc(documentId);
  const existing = await reference.get();
  if (existing.exists) return { id: documentId, duplicate: true };

  const received = params.received ?? await retrieveReceivedEmail(params.emailId, params.apiKey);
  const from = String(received.from || "Remetente não informado");
  const fromAddress = extractEmailAddress(from);
  const senderDomain = fromAddress?.split("@")[1] ?? null;
  const subject = String(received.subject || "Sem assunto").trim().slice(0, 500);
  const parsed = classifyFinancialEmail({ subject, text: received.text, html: received.html, senderDomain });
  const basePath = `financial-inbox/${WORKSPACE_ID}/${documentId}`;
  const archiveWarnings: string[] = [];

  let rawStoragePath: string | null = null;
  let rawSha256: string | null = null;
  if (received.raw?.download_url) {
    const rawBuffer = await downloadBuffer(received.raw.download_url, MAX_RAW_BYTES);
    rawSha256 = sha256(rawBuffer);
    rawStoragePath = `${basePath}/original.eml`;
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(rawStoragePath).save(rawBuffer, {
      resumable: false,
      metadata: {
        contentType: "message/rfc822",
        cacheControl: "private, no-store",
        metadata: { sha256: rawSha256, providerEmailId: params.emailId },
      },
    });
  } else {
    archiveWarnings.push("O provedor não disponibilizou o arquivo original do e-mail.");
  }

  const candidates = (received.attachments ?? [])
    .slice(0, MAX_ATTACHMENTS)
    .filter((attachment) => Number(attachment.size || 0) <= MAX_ATTACHMENT_BYTES);
  let totalBytes = 0;
  const eligible = candidates.filter((attachment) => {
    const nextTotal = totalBytes + Math.max(0, Number(attachment.size) || 0);
    if (nextTotal > MAX_ATTACHMENTS_TOTAL_BYTES) return false;
    totalBytes = nextTotal;
    return true;
  });
  if ((received.attachments?.length ?? 0) > eligible.length) archiveWarnings.push("Um ou mais anexos excederam os limites seguros de arquivamento.");
  const attachments = await Promise.all(eligible.map((attachment) => archiveAttachment({
    emailId: params.emailId,
    attachment,
    apiKey: params.apiKey,
    basePath,
  })));
  if (attachments.some((attachment) => attachment.archiveStatus === "failed")) archiveWarnings.push("Um ou mais anexos não puderam ser arquivados.");

  const now = new Date().toISOString();
  const hasStoredDocument = attachments.some((attachment) => attachment.archiveStatus === "stored");
  const status: FinancialInboxMessage["status"] = !hasStoredDocument && parsed.classification.links.length > 0
    ? "document_pending"
    : "pending_review";
  const message: Omit<FinancialInboxMessage, "id"> = {
    workspaceId: WORKSPACE_ID,
    provider: "resend",
    providerEmailId: params.emailId,
    providerEventId: params.eventId,
    messageId: received.message_id?.trim() || null,
    status,
    from,
    fromAddress,
    senderDomain,
    to: Array.isArray(received.to) ? received.to.map(String) : [],
    originalRecipients: Array.isArray(received.received_for) ? received.received_for.map(String) : [],
    subject,
    receivedAt: received.created_at || params.eventAt,
    textPreview: parsed.textPreview,
    textContent: parsed.textContent,
    classification: parsed.classification,
    attachments,
    rawStoragePath,
    rawSha256,
    archiveWarnings,
    linkedExpenseId: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const batch = financialDbAdmin.batch();
    batch.create(reference, message);
    batch.create(reference.collection("events").doc(safeId(params.eventId)), {
      type: "EMAIL_RECEIVED",
      at: params.eventAt,
      actorId: "system:resend",
      providerEventId: params.eventId,
    });
    await batch.commit();
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return { id: documentId, duplicate: true };
  }
  return { id: documentId, duplicate: false, status };
}
