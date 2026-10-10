import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** The app proves its origin once and then carries this short-lived, user-bound pass on every call. */
export const MOBILE_ATTESTATION_HEADER = "x-coala-app-attestation";
export const MOBILE_ATTESTATION_TTL_MS = 60 * 60 * 1000;
export const MOBILE_ATTESTATION_PACKAGE = "com.coalaone.notas";
/** How old a Play verdict may be when exchanged; older tokens are replays. */
export const MOBILE_INTEGRITY_MAX_AGE_MS = 5 * 60 * 1000;

export type MobileAttestationMode = "off" | "monitor" | "enforce";

export const mobileAttestationRequestSchema = z.object({
  integrityToken: z.string().min(100).max(20_000),
  nonce: z.string().uuid(),
}).strict();

export function mobileAttestationMode(raw: string | undefined): MobileAttestationMode {
  return raw === "monitor" || raw === "enforce" ? raw : "off";
}

/** Binds the Play verdict to the signed-in user and to one exchange. */
export function mobileIntegrityRequestHash(uid: string, nonce: string) {
  return createHash("sha256").update(`${uid}:${nonce}`).digest("base64url");
}

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signMobileAttestation(secret: string, uid: string, now = Date.now()) {
  const payload = `${Buffer.from(uid).toString("base64url")}.${now + MOBILE_ATTESTATION_TTL_MS}`;
  return { token: `${payload}.${signature(secret, payload)}`, expiresAt: now + MOBILE_ATTESTATION_TTL_MS };
}

export function verifyMobileAttestation(secret: string, token: string | null | undefined, uid: string, now = Date.now()) {
  const [encodedUid, expiresAt, provided, ...rest] = (token ?? "").split(".");
  if (!encodedUid || !expiresAt || !provided || rest.length) return false;
  const expected = Buffer.from(signature(secret, `${encodedUid}.${expiresAt}`));
  const received = Buffer.from(provided);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  return Buffer.from(encodedUid, "base64url").toString() === uid && Number(expiresAt) > now;
}

type Verdict = {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string | number };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
};

/** Why a decoded Play Integrity verdict is not acceptable, or null when the call came from the official app. */
export function mobileIntegrityRejection(verdict: Verdict | null | undefined, expected: { requestHash: string; now?: number }) {
  const now = expected.now ?? Date.now();
  const details = verdict?.requestDetails;
  if (details?.requestPackageName !== MOBILE_ATTESTATION_PACKAGE || verdict?.appIntegrity?.packageName !== MOBILE_ATTESTATION_PACKAGE) return "package";
  if (details.requestHash !== expected.requestHash) return "request-hash";
  const issuedAt = Number(details.timestampMillis);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > MOBILE_INTEGRITY_MAX_AGE_MS) return "stale";
  // Only the binary Google Play distributed counts; a re-signed or sideloaded APK is UNRECOGNIZED_VERSION.
  if (verdict?.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") return "app-not-recognized";
  if (!verdict?.deviceIntegrity?.deviceRecognitionVerdict?.includes("MEETS_DEVICE_INTEGRITY")) return "device";
  return null;
}
