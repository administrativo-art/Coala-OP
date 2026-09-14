import { getStorage } from "firebase-admin/storage";
import { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability";

export const BIO_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const bioMediaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireBioManager(request: NextRequest) {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && !(actor.permissions.settings.view && actor.permissions.settings.managePublicBio)) {
    throw new AppError({ code: "PUBLIC_BIO_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para configurar a página pública." });
  }
  return actor;
}

export function bioMediaFile(id: string) {
  if (!bioMediaIdPattern.test(id)) {
    throw new AppError({ code: "PUBLIC_BIO_INVALID_MEDIA_ID", kind: "VALIDATION", safeMessage: "Imagem inválida." });
  }
  return getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(`public-bio/images/${id}.webp`);
}
