import { randomUUID } from "crypto";

import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const CHECKLIST_STORAGE_BUCKET = firebaseClientConfig.storageBucket;
export const CHECKLIST_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const CHECKLIST_SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;

export function sanitizeChecklistAssetName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-");
}

export function detectChecklistImage(buffer: Buffer) {
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

export function buildChecklistStoragePath(params: {
  kind: "photo" | "signature";
  originalName: string;
}) {
  const token = randomUUID();
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const baseName = sanitizeChecklistAssetName(params.originalName || params.kind);

  return {
    downloadToken: token,
    objectPath: `checklists/${params.kind}/${year}/${month}/${Date.now()}-${token}-${baseName}`,
  };
}

export function getChecklistAssetUrl(assetPath: string, downloadToken: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${CHECKLIST_STORAGE_BUCKET}/o/${encodeURIComponent(assetPath)}?alt=media&token=${downloadToken}`;
}
