import type { User } from "@firebase/auth";

import { attestationHeaders } from "./attestation";
import { appConfig } from "./config";
import { authenticatedJson } from "./upload";

export type AppProfile = { name: string; email: string | null; role: string | null; avatarUrl: string | null };
/** Módulos que o perfil de permissões da pessoa libera no aplicativo. */
export type AppModules = { localPurchase: boolean; stockCount: boolean; repositionReceipt: boolean; goals: boolean; schedule: boolean };

export function loadAppProfile(user: User) {
  return authenticatedJson<{ profile: AppProfile; modules: AppModules }>(user, "/api/mobile/profile");
}

/** Troca a própria foto de perfil; a nova imagem passa a valer no aplicativo e no Coala One. */
export async function uploadProfilePhoto(user: User, photo: { uri: string; mimeType: string }) {
  const body = new FormData();
  body.append("photo", { uri: photo.uri, name: "foto-de-perfil", type: photo.mimeType } as unknown as Blob);
  const response = await fetch(`${appConfig.apiBaseUrl}/api/mobile/profile/photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(await attestationHeaders(user)) },
    body,
  });
  const raw = await response.text();
  let payload: { avatarUrl?: string; error?: { message?: string } | string; message?: string } = {};
  try { payload = JSON.parse(raw); } catch { /* resposta não JSON não é exibida */ }
  if (!response.ok || !payload.avatarUrl) {
    const message = typeof payload.error === "object" ? payload.error?.message : typeof payload.error === "string" ? payload.error : payload.message;
    throw new Error(message || `Não foi possível salvar a foto (HTTP ${response.status}).`);
  }
  return payload.avatarUrl;
}
