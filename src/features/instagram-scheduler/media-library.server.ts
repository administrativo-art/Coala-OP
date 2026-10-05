import "server-only";

import { randomUUID } from "node:crypto";

import { getStorage } from "firebase-admin/storage";
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

import type { ServerUserContext } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";

import type {
  InstagramMediaLibraryItem,
} from "./contracts";
import {
  detectInstagramLibraryMedia,
  INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES,
  INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES,
  safeInstagramLibraryFileName,
} from "./media-validation";

export const INSTAGRAM_LIBRARY_LIST_LIMIT = 60;

function iso(value: unknown): string {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  return "";
}

export function serializeInstagramLibraryMedia(doc: DocumentSnapshot): InstagramMediaLibraryItem {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    fileName: typeof data.fileName === "string" ? data.fileName : "mídia",
    folderId: typeof data.folderId === "string" ? data.folderId : null,
    kind: data.kind === "video" ? "video" : "image",
    contentType: typeof data.contentType === "string" ? data.contentType : "application/octet-stream",
    sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : 0,
    width: typeof data.width === "number" ? data.width : null,
    height: typeof data.height === "number" ? data.height : null,
    previewUrl: `/api/integrations/instagram/media/${encodeURIComponent(doc.id)}`,
    createdAt: iso(data.createdAt),
  };
}

export async function storeInstagramLibraryMedia(input: {
  context: ServerUserContext;
  file: File;
  folderId: string | null;
}) {
  const { context, file, folderId } = input;
  if (file.size <= 0) {
    throw new AppError({
      code: "INSTAGRAM_LIBRARY_EMPTY_FILE",
      kind: "VALIDATION",
      safeMessage: "O arquivo está vazio.",
      reportable: false,
    });
  }
  if (file.size > INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES) {
    throw new AppError({
      code: "INSTAGRAM_LIBRARY_FILE_TOO_LARGE",
      kind: "VALIDATION",
      safeMessage: "Vídeos devem ter até 24 MB e imagens até 8 MB.",
      reportable: false,
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = await detectInstagramLibraryMedia(buffer);
  const maxBytes = detected.kind === "image"
    ? INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES
    : INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES;
  if (buffer.byteLength > maxBytes) {
    throw new AppError({
      code: "INSTAGRAM_LIBRARY_FILE_TOO_LARGE",
      kind: "VALIDATION",
      safeMessage: detected.kind === "image"
        ? "Imagens devem ter até 8 MB."
        : "Vídeos devem ter até 24 MB.",
      reportable: false,
    });
  }

  const id = randomUUID();
  const fileName = safeInstagramLibraryFileName(file.name, detected.extension);
  const objectPath = `instagram/library/${context.workspace_id}/${id}/${fileName}`;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const object = bucket.file(objectPath);

  await object.save(buffer, {
    resumable: detected.kind === "video",
    metadata: {
      contentType: detected.contentType,
      cacheControl: "private, no-store",
      metadata: {
        uploadedBy: context.decoded.uid,
        workspaceId: context.workspace_id,
        mediaLibraryId: id,
      },
    },
  });

  const ref = marketingDbAdmin.collection("instagramMediaLibrary").doc(id);
  try {
    const createdAt = Timestamp.now();
    await ref.create({
      workspace_id: context.workspace_id,
      fileName,
      originalFileName: file.name.slice(0, 255),
      folderId,
      kind: detected.kind,
      contentType: detected.contentType,
      sizeBytes: buffer.byteLength,
      width: detected.width,
      height: detected.height,
      objectPath,
      createdAt,
      updatedAt: createdAt,
      createdBy: {
        uid: context.decoded.uid,
        email: context.decoded.email ?? context.userDoc.email ?? null,
      },
    });
  } catch (cause) {
    await object.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw cause;
  }

  return serializeInstagramLibraryMedia(await ref.get());
}
