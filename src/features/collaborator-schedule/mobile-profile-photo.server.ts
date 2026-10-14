import "server-only";

import { randomUUID } from "node:crypto";

import { getStorage } from "firebase-admin/storage";

import type { ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import type { DetectedMobileInboxFile } from "@/features/financial/inbox/mobile-upload";

/** Same ceiling the web profile and the storage rules apply to `avatars/{userId}`. */
export const MOBILE_PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Replaces the signed-in person's own photo, at the same storage path and user field the web
 * profile writes. The path comes from the session, never from the request.
 */
export async function replaceOwnProfilePhoto(actor: ServerUserContext, photo: { buffer: Buffer; detected: DetectedMobileInboxFile }) {
  const userId = actor.userDoc.id;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const path = `avatars/${userId}`;
  const token = randomUUID();
  await bucket.file(path).save(photo.buffer, {
    resumable: false,
    metadata: {
      contentType: photo.detected.contentType,
      cacheControl: "private, max-age=0, no-store",
      metadata: { firebaseStorageDownloadTokens: token, avatarSource: "coala-notas-android", uploadedBy: actor.decoded.uid },
    },
  });
  const avatarUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
  await dbAdmin.collection("users").doc(userId).set({ avatarUrl, avatarUpdatedAt: new Date().toISOString() }, { merge: true });
  return avatarUrl;
}
