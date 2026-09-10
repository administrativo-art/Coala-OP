import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { getStorage } from "firebase-admin/storage";

import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { extractExternalLinks } from "./parser";
import {
  isAllowedFinancialDocumentUrl,
  isLikelyFinancialDocumentUrl,
  isPrivateNetworkAddress,
  safeFinancialDocumentSourceUrl,
} from "./linked-document-policy";
import type { FinancialInboxAttachment, FinancialInboxLinkResolution, FinancialInboxMessage } from "./types";

const MAX_LINKS_TO_CHECK = 2;
const MAX_REDIRECTS = 3;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_HTML_BYTES = 1024 * 1024;

type ResolvedResponse = {
  kind: "document";
  url: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
} | {
  kind: "requires_login" | "not_found" | "blocked" | "failed";
  url: string;
};

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 160) || "documento";
}

function contentTypeFrom(response: Response, buffer: Buffer, url: string) {
  const declared = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const textualPrefix = buffer.subarray(0, 512).toString("utf8").trimStart();
  if ((declared.includes("xml") || /\.xml$/i.test(new URL(url).pathname)) && /^<\?xml\b|^<[A-Za-z_][\w:.-]*/.test(textualPrefix)) {
    return "application/xml";
  }
  if ((declared === "text/plain" || declared === "text/csv") && !buffer.includes(0)) return declared;
  if (declared === "text/html" || declared === "application/xhtml+xml") return "text/html";
  return "application/octet-stream";
}

function filenameFrom(response: Response, url: string, contentType: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const regular = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let value = encoded ? decodeURIComponent(encoded) : regular;
  if (!value) value = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "documento";
  const extension = contentType === "application/pdf" ? ".pdf"
    : contentType === "application/xml" ? ".xml"
      : contentType.startsWith("image/") ? `.${contentType.split("/")[1].replace("jpeg", "jpg")}`
        : ".txt";
  if (!value.includes(".")) value += extension;
  return safeFileName(value);
}

async function assertPublicHostname(url: URL) {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw new Error("PRIVATE_NETWORK_ADDRESS");
  }
}

async function readLimited(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximum) throw new Error("DOCUMENT_TOO_LARGE");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("DOCUMENT_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function fetchFollowingSafeRedirects(rawUrl: string, senderDomain: string | null) {
  let current = rawUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!isAllowedFinancialDocumentUrl(current, senderDomain)) throw new Error("LINK_NOT_ALLOWED");
    const url = new URL(current);
    await assertPublicHostname(url);
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "application/pdf, application/xml, text/xml, image/*, text/html;q=0.8" },
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("REDIRECT_NOT_ALLOWED");
      current = new URL(location, url).toString();
      continue;
    }
    return { response, url: current };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

function isSupportedDocument(contentType: string) {
  return contentType === "application/pdf"
    || contentType === "application/xml"
    || contentType === "text/xml"
    || contentType === "text/plain"
    || contentType === "text/csv"
    || contentType.startsWith("image/");
}

async function resolveUrl(rawUrl: string, senderDomain: string | null, depth = 0): Promise<ResolvedResponse> {
  try {
    const { response, url } = await fetchFollowingSafeRedirects(rawUrl, senderDomain);
    if (response.status === 401 || response.status === 403) return { kind: "requires_login", url };
    if (!response.ok) return { kind: response.status === 404 ? "not_found" : "failed", url };
    const declaredType = (response.headers.get("content-type") || "").toLowerCase();
    const maximum = declaredType.includes("html") ? MAX_HTML_BYTES : MAX_DOCUMENT_BYTES;
    const buffer = await readLimited(response, maximum);
    const contentType = contentTypeFrom(response, buffer, url);
    if (isSupportedDocument(contentType)) {
      return { kind: "document", url, buffer, contentType, filename: filenameFrom(response, url, contentType) };
    }
    if (contentType !== "text/html" || depth >= 1) return { kind: "not_found", url };
    const html = buffer.toString("utf8");
    if (/<(?:input|form)[^>]+(?:password|login|senha)/i.test(html)) return { kind: "requires_login", url };
    const rawCandidates = [
      ...extractExternalLinks("", html),
      ...Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi), (match) => match[1]),
    ];
    const candidates = [...new Set(rawCandidates
      .flatMap((entry) => {
        try {
          return [new URL(entry, url).toString()];
        } catch {
          return [];
        }
      }))]
      .filter((entry) => isAllowedFinancialDocumentUrl(entry, senderDomain))
      .filter(isLikelyFinancialDocumentUrl)
      .slice(0, 3);
    for (const candidate of candidates) {
      const nested = await resolveUrl(candidate, senderDomain, depth + 1);
      if (nested.kind === "document" || nested.kind === "requires_login") return nested;
    }
    return { kind: "requires_login", url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { kind: message === "LINK_NOT_ALLOWED" || message === "PRIVATE_NETWORK_ADDRESS" ? "blocked" : "failed", url: rawUrl };
  }
}

function documentCandidateLinks(message: FinancialInboxMessage) {
  const allowed = message.classification.links
    .filter((link) => isAllowedFinancialDocumentUrl(link, message.senderDomain));
  const likely = allowed.filter(isLikelyFinancialDocumentUrl);
  return (likely.length ? likely : allowed.length === 1 ? allowed : []).slice(0, MAX_LINKS_TO_CHECK);
}

export async function archiveFinancialInboxLinkedDocuments(message: FinancialInboxMessage) {
  const checkedAt = new Date().toISOString();
  const storedSource = message.attachments.some((attachment) => attachment.archiveStatus === "stored" && attachment.sourceType !== "link");
  if (storedSource || message.classification.links.length === 0) {
    return {
      attachments: message.attachments,
      resolution: {
        status: storedSource ? "not_needed" : "not_checked",
        checkedAt,
        sourceDomain: null,
        message: storedSource ? "O documento chegou anexado ao e-mail." : null,
      } satisfies FinancialInboxLinkResolution,
    };
  }
  const links = documentCandidateLinks(message);
  if (!links.length) {
    return {
      attachments: message.attachments,
      resolution: {
        status: "blocked",
        checkedAt,
        sourceDomain: null,
        message: "O link não pertence a um domínio documental autorizado.",
      } satisfies FinancialInboxLinkResolution,
    };
  }

  let last: ResolvedResponse | null = null;
  const attachments = [...message.attachments];
  let storedLinkedDocuments = attachments.filter(
    (attachment) => attachment.archiveStatus === "stored" && attachment.sourceType === "link",
  ).length;
  for (const link of links) {
    const fingerprint = createHash("sha256").update(link).digest("hex");
    if (attachments.some((attachment) => attachment.sourceFingerprint === fingerprint)) continue;
    const resolved = await resolveUrl(link, message.senderDomain);
    last = resolved;
    if (resolved.kind !== "document") continue;
    const hash = createHash("sha256").update(resolved.buffer).digest("hex");
    if (attachments.some((attachment) => attachment.sha256 === hash)) continue;
    const id = `link_${fingerprint.slice(0, 24)}`;
    const storagePath = `financial-inbox/${safeId(message.workspaceId)}/${safeId(message.id)}/linked/${id}-${resolved.filename}`;
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(resolved.buffer, {
      resumable: false,
      metadata: {
        contentType: resolved.contentType,
        cacheControl: "private, no-store",
        metadata: { sha256: hash, sourceDomain: new URL(resolved.url).hostname },
      },
    });
    const attachment: FinancialInboxAttachment = {
      id,
      filename: resolved.filename,
      contentType: resolved.contentType,
      size: resolved.buffer.byteLength,
      contentDisposition: "link",
      storagePath,
      sha256: hash,
      archiveStatus: "stored",
      sourceType: "link",
      sourceDomain: new URL(resolved.url).hostname,
      sourceUrl: safeFinancialDocumentSourceUrl(resolved.url),
      sourceFingerprint: fingerprint,
      extractionStatus: "not_attempted",
    };
    attachments.push(attachment);
    storedLinkedDocuments += 1;
  }

  if (storedLinkedDocuments > 0) {
    const storedLinkedSource = attachments.findLast(
      (attachment) => attachment.archiveStatus === "stored" && attachment.sourceType === "link",
    );
    return {
      attachments,
      resolution: {
        status: "resolved",
        checkedAt,
        sourceDomain: storedLinkedSource?.sourceDomain ?? null,
        message: storedLinkedDocuments === 1
          ? "O documento indicado pelo link foi arquivado com segurança."
          : `${storedLinkedDocuments} documentos indicados pelos links foram arquivados com segurança.`,
      } satisfies FinancialInboxLinkResolution,
    };
  }

  const status = last?.kind === "requires_login" ? "requires_login"
    : last?.kind === "blocked" ? "blocked"
      : last?.kind === "failed" ? "failed"
        : "not_found";
  return {
    attachments: message.attachments,
    resolution: {
      status,
      checkedAt,
      sourceDomain: last ? new URL(last.url).hostname : null,
      message: status === "requires_login"
        ? "O fornecedor exige acesso ao portal para liberar o documento. Abra o link e anexe o arquivo manualmente."
        : status === "blocked"
          ? "O link foi bloqueado pela política de segurança."
          : status === "failed"
            ? "Não foi possível consultar o link agora. Tente analisar novamente."
            : "Nenhum documento direto foi encontrado no link.",
    } satisfies FinancialInboxLinkResolution,
  };
}
