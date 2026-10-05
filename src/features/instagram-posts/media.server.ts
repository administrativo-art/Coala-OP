import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";

import {
  detectInstagramLibraryMedia,
  INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES,
  INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES,
  safeInstagramLibraryFileName,
} from "@/features/instagram-scheduler/media-validation";
import type { ServerUserContext } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";

import { instagramPostContentHash } from "./service.server";
import { serializeInstagramPost } from "./serialize.server";

function invalid(code: string, safeMessage: string): never {
  throw new AppError({ code, kind: "VALIDATION", safeMessage, reportable: false });
}

export async function addInstagramPostMedia(context: ServerUserContext, id: string, file: File) {
  if (!file.size) invalid("INSTAGRAM_POST_EMPTY_MEDIA", "O arquivo está vazio.");
  if (file.size > INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES) invalid("INSTAGRAM_POST_MEDIA_TOO_LARGE", "Vídeos devem ter até 24 MB e imagens até 8 MB.");
  const source = Buffer.from(await file.arrayBuffer());
  const detected = await detectInstagramLibraryMedia(source);
  const limit = detected.kind === "image" ? INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES : INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES;
  if (source.byteLength > limit) invalid("INSTAGRAM_POST_MEDIA_TOO_LARGE", detected.kind === "image" ? "Imagens devem ter até 8 MB." : "Vídeos devem ter até 24 MB.");
  const buffer = detected.kind === "image" && detected.contentType !== "image/jpeg"
    ? await sharp(source).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer()
    : source;
  if (detected.kind === "image" && buffer.byteLength > INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES) {
    invalid("INSTAGRAM_POST_MEDIA_TOO_LARGE", "A imagem convertida para JPG excede 8 MB.");
  }

  const ref = marketingDbAdmin.collection("instagramPosts").doc(id);
  const snapshot = await ref.get();
  const current = snapshot.data();
  if (!snapshot.exists || current?.workspace_id !== context.workspace_id) {
    throw new AppError({ code: "INSTAGRAM_POST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Post não encontrado.", reportable: false });
  }
  if (!["planned", "produced"].includes(current.status)) {
    throw new AppError({ code: "INSTAGRAM_POST_PROTECTED", kind: "CONFLICT", safeMessage: "Posts programados ou publicados não aceitam nova mídia.", reportable: false });
  }
  const mediaId = randomUUID();
  const contentType = detected.kind === "image" ? "image/jpeg" : detected.contentType;
  const extension = detected.kind === "image" ? "jpg" : detected.extension;
  const fileName = safeInstagramLibraryFileName(file.name, extension);
  const objectPath = `instagram/editorial/${current.folderPath}/media/${mediaId}-${fileName}`;
  const downloadToken = randomUUID();
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  await bucket.file(objectPath).save(buffer, {
    resumable: detected.kind === "video",
    metadata: {
      contentType,
      cacheControl: "private, max-age=3600",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        uploadedBy: context.decoded.uid,
        workspaceId: context.workspace_id,
        instagramPostId: id,
      },
    },
  });

  try {
    const media = {
      id: mediaId,
      kind: detected.kind,
      contentType,
      fileName,
      sizeBytes: buffer.byteLength,
      width: detected.width,
      height: detected.height,
      durationSeconds: detected.durationSeconds,
      videoCodec: detected.videoCodec,
      audioCodec: detected.audioCodec,
      frameRate: detected.frameRate,
      videoBitrateBps: detected.videoBitrateBps,
      audioSampleRateHz: detected.audioSampleRateHz,
      fastStart: detected.fastStart,
      hasEditList: detected.hasEditList,
      sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
      objectPath,
      deliveryUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseClientConfig.storageBucket)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`,
    };
    await marketingDbAdmin.runTransaction(async (transaction) => {
      const latestSnapshot = await transaction.get(ref);
      const latest = latestSnapshot.data();
      if (!latestSnapshot.exists || latest?.workspace_id !== context.workspace_id) throw new Error("Post removido durante o upload.");
      if (!["planned", "produced"].includes(latest.status)) throw new Error("Post protegido durante o upload.");
      if (Array.isArray(latest.media) && latest.media.length >= 10) {
        invalid("INSTAGRAM_POST_MEDIA_LIMIT", "Cada post aceita no máximo dez mídias.");
      }
      const nextMedia = [...(Array.isArray(latest.media) ? latest.media : []), media];
      const next = { ...latest, media: nextMedia };
      const now = Timestamp.now();
      transaction.update(ref, {
        media: nextMedia,
        contentHash: instagramPostContentHash(next),
        contentApproval: { status: "pending" },
        publicationApproval: { status: "pending" },
        publicationCertification: FieldValue.delete(),
        version: (typeof latest.version === "number" ? latest.version : 1) + 1,
        updatedAt: now,
        updatedBy: {
          source: "marketing-cli",
          uid: context.decoded.uid,
          email: context.decoded.email ?? context.userDoc.email ?? null,
        },
      });
      transaction.create(ref.collection("events").doc(randomUUID()), {
        type: "media_uploaded",
        mediaId,
        fileName,
        sha256: media.sha256,
        actor: {
          source: "marketing-cli",
          uid: context.decoded.uid,
          email: context.decoded.email ?? context.userDoc.email ?? null,
        },
        createdAt: now,
      });
    });
  } catch (cause) {
    await bucket.file(objectPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw cause;
  }
  return serializeInstagramPost(await ref.get());
}
