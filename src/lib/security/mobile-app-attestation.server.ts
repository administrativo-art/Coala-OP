import "server-only";

import { GoogleAuth } from "google-auth-library";
import type { NextRequest } from "next/server";

import { AppError } from "@/lib/observability/app-error";
import {
  MOBILE_ATTESTATION_HEADER,
  MOBILE_ATTESTATION_PACKAGE,
  mobileAttestationMode,
  mobileIntegrityRejection,
  mobileIntegrityRequestHash,
  signMobileAttestation,
  verifyMobileAttestation,
} from "./mobile-app-attestation";

const PLAY_INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";
let googleAuth: GoogleAuth | null = null;

function secret() {
  const value = process.env.MOBILE_APP_ATTESTATION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new AppError({ code: "MOBILE_ATTESTATION_NOT_CONFIGURED", kind: "UNEXPECTED_APPLICATION", safeMessage: "A verificação do aplicativo não está configurada." });
  }
  return value;
}

export function currentMobileAttestationMode() {
  return mobileAttestationMode(process.env.MOBILE_APP_ATTESTATION_MODE?.trim());
}

/**
 * Gate for the routes only the Android app calls. `off` keeps Expo Go and local
 * builds working; `monitor` lets the rollout be observed; `enforce` rejects any
 * client that did not come from the Play-distributed app.
 */
export function assertMobileAppAttested(request: NextRequest, uid: string) {
  const mode = currentMobileAttestationMode();
  if (mode === "off") return;
  if (verifyMobileAttestation(secret(), request.headers.get(MOBILE_ATTESTATION_HEADER), uid)) return;
  if (mode === "monitor") {
    console.info("[mobile-app-attestation] chamada sem atestado válido", { path: request.nextUrl.pathname });
    return;
  }
  throw new AppError({ code: "MOBILE_ATTESTATION_REQUIRED", kind: "AUTHORIZATION", safeMessage: "Atualize o Coala One pela Play Store para continuar." });
}

/** Exchanges a Play Integrity token, decoded by Google, for the short-lived pass. */
export async function issueMobileAttestation(input: { uid: string; integrityToken: string; nonce: string }) {
  const signingSecret = secret();
  googleAuth ??= new GoogleAuth({ scopes: [PLAY_INTEGRITY_SCOPE] });
  const accessToken = await googleAuth.getAccessToken();
  const response = await fetch(`https://playintegrity.googleapis.com/v1/${MOBILE_ATTESTATION_PACKAGE}:decodeIntegrityToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ integrity_token: input.integrityToken }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new AppError({ code: "MOBILE_ATTESTATION_DECODE_FAILED", kind: "TRANSIENT_EXTERNAL", safeMessage: "Não foi possível verificar o aplicativo agora. Tente novamente." });
  }
  const payload = await response.json() as { tokenPayloadExternal?: Parameters<typeof mobileIntegrityRejection>[0] };
  const rejection = mobileIntegrityRejection(payload.tokenPayloadExternal, { requestHash: mobileIntegrityRequestHash(input.uid, input.nonce) });
  if (rejection) {
    throw new AppError({ code: "MOBILE_ATTESTATION_REJECTED", kind: "AUTHORIZATION", safeMessage: "Este aparelho ou esta instalação do aplicativo não pôde ser verificado.", cause: new Error(rejection) });
  }
  return signMobileAttestation(signingSecret, input.uid);
}
