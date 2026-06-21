import { extname } from "path";
import { randomUUID } from "crypto";

import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const FORMS_STORAGE_BUCKET = firebaseClientConfig.storageBucket;
export const FORMS_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const FORMS_SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
export const FORMS_FILE_MAX_BYTES = 10 * 1024 * 1024;

export function sanitizeFormAssetName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-");
}

export function detectFormImage(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { extension: "png", contentType: "image/png" };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp" };
  }

  return null;
}

export function buildFormStoragePath(params: {
  kind: "photo" | "signature" | "file";
  originalName: string;
  executionId?: string;
}) {
  const token = randomUUID();
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const baseName = sanitizeFormAssetName(params.originalName || params.kind);
  const executionSegment = params.executionId
    ? `${sanitizeFormAssetName(params.executionId)}/`
    : "";

  return {
    downloadToken: token,
    objectPath: `forms/${executionSegment}${params.kind}/${year}/${month}/${Date.now()}-${token}-${baseName}`,
  };
}

export function getFormAssetUrl(assetPath: string, downloadToken: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${FORMS_STORAGE_BUCKET}/o/${encodeURIComponent(assetPath)}?alt=media&token=${downloadToken}`;
}

export function detectFileMetadata(file: File, fallbackKind: "file" | "photo" | "signature") {
  const extension = extname(file.name || "").replace(".", "").toLowerCase() || fallbackKind;
  const allowed: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  if (!allowed[extension]) return null;

  return {
    extension,
    contentType: allowed[extension] || file.type || "application/octet-stream",
  };
}
