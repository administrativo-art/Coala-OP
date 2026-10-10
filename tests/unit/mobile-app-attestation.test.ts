import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MOBILE_ATTESTATION_TTL_MS,
  mobileAttestationMode,
  mobileAttestationRequestSchema,
  mobileIntegrityRejection,
  mobileIntegrityRequestHash,
  signMobileAttestation,
  verifyMobileAttestation,
} from "../../src/lib/security/mobile-app-attestation";

const secret = "s".repeat(40);

test("attestation pass is bound to the user, expires and cannot be forged", () => {
  const now = 1_800_000_000_000;
  const { token, expiresAt } = signMobileAttestation(secret, "user-a", now);
  assert.equal(expiresAt, now + MOBILE_ATTESTATION_TTL_MS);
  assert.equal(verifyMobileAttestation(secret, token, "user-a", now + 1000), true);
  assert.equal(verifyMobileAttestation(secret, token, "user-b", now + 1000), false);
  assert.equal(verifyMobileAttestation(secret, token, "user-a", expiresAt + 1), false);
  assert.equal(verifyMobileAttestation("x".repeat(40), token, "user-a", now + 1000), false);
  const [uid, , signature] = token.split(".");
  assert.equal(verifyMobileAttestation(secret, `${uid}.${expiresAt + 10 ** 9}.${signature}`, "user-a", now + 1000), false);
  for (const invalid of [null, undefined, "", "a.b", "a.b.c.d"]) assert.equal(verifyMobileAttestation(secret, invalid, "user-a", now), false);
});

test("attestation is off unless explicitly monitored or enforced", () => {
  assert.equal(mobileAttestationMode(undefined), "off");
  assert.equal(mobileAttestationMode("true"), "off");
  assert.equal(mobileAttestationMode("monitor"), "monitor");
  assert.equal(mobileAttestationMode("enforce"), "enforce");
});

test("only a fresh Play verdict for the official app, this user and this exchange is accepted", () => {
  const now = 1_800_000_000_000;
  const requestHash = mobileIntegrityRequestHash("user-a", "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e");
  const verdict = {
    requestDetails: { requestPackageName: "com.coalaone.notas", requestHash, timestampMillis: String(now - 1000) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.coalaone.notas" },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
  };
  assert.equal(mobileIntegrityRejection(verdict, { requestHash, now }), null);
  assert.equal(mobileIntegrityRejection(null, { requestHash, now }), "package");
  assert.equal(mobileIntegrityRejection({ ...verdict, appIntegrity: { ...verdict.appIntegrity, packageName: "com.evil" } }, { requestHash, now }), "package");
  assert.equal(mobileIntegrityRejection(verdict, { requestHash: mobileIntegrityRequestHash("user-b", "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e"), now }), "request-hash");
  assert.equal(mobileIntegrityRejection(verdict, { requestHash, now: now + 10 * 60 * 1000 }), "stale");
  assert.equal(mobileIntegrityRejection({ ...verdict, appIntegrity: { ...verdict.appIntegrity, appRecognitionVerdict: "UNRECOGNIZED_VERSION" } }, { requestHash, now }), "app-not-recognized");
  assert.equal(mobileIntegrityRejection({ ...verdict, deviceIntegrity: { deviceRecognitionVerdict: [] } }, { requestHash, now }), "device");
});

test("attestation exchange rejects unknown fields and every app route is gated", () => {
  const valid = { integrityToken: "t".repeat(200), nonce: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e" };
  assert.equal(mobileAttestationRequestSchema.safeParse(valid).success, true);
  assert.equal(mobileAttestationRequestSchema.safeParse({ ...valid, uid: "user-b" }).success, false);
  assert.equal(mobileAttestationRequestSchema.safeParse({ ...valid, nonce: "1" }).success, false);
  for (const route of [
    "src/app/api/financial/inbox/mobile-upload/route.ts",
    "src/app/api/purchasing/local-purchases/context/route.ts",
    "src/app/api/purchasing/local-purchases/confirm/route.ts",
    "src/app/api/purchasing/local-purchases/withdrawals/route.ts",
  ]) assert.match(readFileSync(route, "utf8"), /assertMobileAppAttested\(request, actor\.decoded\.uid\)/);
});
