import "server-only";

import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability/app-error";

type AuditPhoto = { storagePath: string; contentHash: string; mimeType: string; size: number };
export const auditUploadId = (storagePath: string) => `aau_${createHash("sha256").update(storagePath).digest("hex").slice(0, 32)}`;

export async function verifyAndClaimAssetAuditPhotos(workspaceId: string, assetId: string, auditId: string, photos: AuditPhoto[]) {
  const prefix = `assets/${workspaceId}/${assetId}/audits/`;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const verified = await Promise.all(photos.map(async (photo) => {
    if (!photo.storagePath.startsWith(prefix) || photo.storagePath.includes("..")) {
      throw new AppError({ code: "ASSET_AUDIT_PHOTO_SCOPE", kind: "AUTHORIZATION" });
    }
    const file = bucket.file(photo.storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new AppError({ code: "ASSET_AUDIT_PHOTO_NOT_FOUND", kind: "VALIDATION", safeMessage: "Uma foto da auditoria não foi encontrada." });
    const [metadata] = await file.getMetadata();
    const custom = metadata.metadata ?? {};
    const contentType = String(metadata.contentType ?? "");
    const size = Number(metadata.size ?? 0);
    if (custom.assetId !== assetId || custom.workspaceId !== workspaceId || custom.assetFileKind !== "audit" || custom.auditUploadId !== auditUploadId(photo.storagePath)
      || contentType !== photo.mimeType || size !== photo.size) {
      throw new AppError({ code: "ASSET_AUDIT_PHOTO_METADATA", kind: "VALIDATION", safeMessage: "Os metadados da foto da auditoria são inválidos." });
    }
    const [buffer] = await file.download();
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    if (contentHash !== photo.contentHash || custom.contentHash !== contentHash) {
      throw new AppError({ code: "ASSET_AUDIT_PHOTO_HASH", kind: "VALIDATION", safeMessage: "A integridade da foto da auditoria não pôde ser confirmada." });
    }
    return { storagePath: photo.storagePath, contentHash, mimeType: contentType, size };
  }));
  const now = new Date();
  await dbClaim(workspaceId, assetId, auditId, verified.map((photo) => photo.storagePath), now);
  return verified;
}

async function dbClaim(workspaceId: string, assetId: string, auditId: string, paths: string[], now: Date) {
  await dbAdmin.runTransaction(async (transaction) => {
    const references = paths.map((path) => dbAdmin.collection("assetAuditUploads").doc(auditUploadId(path)));
    const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      if (!snapshot.exists || snapshot.get("workspaceId") !== workspaceId || snapshot.get("assetId") !== assetId || snapshot.get("storagePath") !== paths[index]) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_INVALID", kind: "VALIDATION", safeMessage: "A foto não pertence a este patrimônio." });
      const consumedAuditId = String(snapshot.get("consumedAuditId") ?? "");
      if (consumedAuditId && consumedAuditId !== auditId) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_CONSUMED", kind: "CONFLICT", safeMessage: "Esta foto já foi usada em outra auditoria." });
      if (!consumedAuditId && new Date(String(snapshot.get("expiresAt"))).getTime() < now.getTime()) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_EXPIRED", kind: "VALIDATION", safeMessage: "A foto expirou. Envie-a novamente." });
    }
    references.forEach((reference) => transaction.set(reference, { status: "consumed", consumedAuditId: auditId, consumedAt: now.toISOString(), updatedAt: now.toISOString() }, { merge: true }));
  });
}
