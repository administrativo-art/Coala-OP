const DEMO_PROJECT_ID = /^demo-[a-z0-9][a-z0-9-]*$/;

export const KNOWN_FIRESTORE_DATABASE_IDS = Object.freeze([
  "coala",
  "coala-signage",
  "coala-financeiro",
  "coala-rh",
  "coala-checklist",
]);

export const FIREBASE_TEST_CREDENTIAL_ENV_KEYS = Object.freeze([
  "GOOGLE_APPLICATION_CREDENTIALS",
  "FIREBASE_SERVICE_ACCOUNT",
  "FIREBASE_SERVICE_ACCOUNT_PATH",
  "FIREBASE_SERVICE_ACCOUNT_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "GCLOUD_SERVICE_KEY",
  "DP_FIREBASE_CLIENT_EMAIL",
  "DP_FIREBASE_PRIVATE_KEY",
]);

function assertLocalEmulatorHost(value) {
  if (!value) {
    throw new Error("FIRESTORE_EMULATOR_HOST ausente; teste abortado antes de inicializar o Firestore.");
  }

  const normalized = value.replace(/^https?:\/\//i, "");
  const host = normalized.startsWith("[")
    ? normalized.slice(1, normalized.indexOf("]"))
    : normalized.split(":")[0];
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`FIRESTORE_EMULATOR_HOST deve apontar para loopback; recebido: ${host || "vazio"}.`);
  }
}

export function assertFirestoreEmulatorSafety({
  projectId,
  databaseId,
  env = process.env,
}) {
  assertLocalEmulatorHost(env.FIRESTORE_EMULATOR_HOST);

  if (!DEMO_PROJECT_ID.test(projectId)) {
    throw new Error(`Project ID de teste inválido: ${projectId}. Use o prefixo demo-.`);
  }

  if (!KNOWN_FIRESTORE_DATABASE_IDS.includes(databaseId)) {
    throw new Error(`Database ID não reconhecido para teste: ${databaseId}.`);
  }

  const credentialKey = FIREBASE_TEST_CREDENTIAL_ENV_KEYS.find((key) => Boolean(env[key]));
  if (credentialKey) {
    throw new Error(`${credentialKey} não deve estar definido em testes do emulador.`);
  }

  return Object.freeze({ projectId, databaseId });
}
