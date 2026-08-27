import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFirestoreEmulatorSafety,
  assertNoFirebaseTestCredentials,
} from "../helpers/firestore-emulator-safety.mjs";

const safeEnv = Object.freeze({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });

test("aceita somente project demo e emulador local", () => {
  assert.deepEqual(
    assertFirestoreEmulatorSafety({ projectId: "demo-coala-rules", env: safeEnv }),
    { projectId: "demo-coala-rules" },
  );
});

test("aborta quando o host do emulador está ausente ou não é local", () => {
  assert.throws(
    () => assertFirestoreEmulatorSafety({ projectId: "demo-coala-rules", env: {} }),
    /FIRESTORE_EMULATOR_HOST ausente/,
  );
  assert.throws(
    () => assertFirestoreEmulatorSafety({
      projectId: "demo-coala-rules",
      env: { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" },
    }),
    /deve apontar para loopback/,
  );
});

test("aborta quando o project ID não é inequivocamente de teste", () => {
  assert.throws(
    () => assertFirestoreEmulatorSafety({ projectId: "smart-converter-752gf", env: safeEnv }),
    /Use o prefixo demo-/,
  );
});

test("aborta quando há credencial Firebase ou Google no ambiente", () => {
  assert.throws(
    () => assertNoFirebaseTestCredentials({ GOOGLE_APPLICATION_CREDENTIALS: "/tmp/real.json" }),
    /GOOGLE_APPLICATION_CREDENTIALS/,
  );
  assert.throws(
    () => assertFirestoreEmulatorSafety({
      projectId: "demo-coala-rules",
      env: { ...safeEnv, FIREBASE_SERVICE_ACCOUNT_JSON: "redacted" },
    }),
    /FIREBASE_SERVICE_ACCOUNT_JSON/,
  );
});
