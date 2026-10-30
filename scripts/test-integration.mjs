import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { FIREBASE_TEST_CREDENTIAL_ENV_KEYS } from "../tests/helpers/firestore-emulator-safety.mjs";

const TEST_PROJECT_ID = "demo-coala-repository";
const vacationDocumentsOnly = process.argv.includes('--vacation-documents');
const lgpdV5Only = process.argv.includes("--lgpd-v5");

function javaHomeFromMac() {
  if (process.platform !== "darwin") return null;
  for (const args of [["-v", "11+"], []]) {
    try {
      const value = execFileSync("/usr/libexec/java_home", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (value) return value;
    } catch {
      // Continue with the fixed local fallbacks below.
    }
  }
  return null;
}

function hasJava(javaHome) {
  return Boolean(javaHome && existsSync(join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")));
}

const credentialKey = FIREBASE_TEST_CREDENTIAL_ENV_KEYS.find((key) => Boolean(process.env[key]));
if (credentialKey) {
  process.stderr.write(`[test:integration] ${credentialKey} deve estar ausente; o teste usa somente o emulador.\n`);
  process.exit(1);
}

const candidates = [
  process.env.JAVA_HOME,
  javaHomeFromMac(),
  "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
  "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
].filter(Boolean);
const javaHome = candidates.find(hasJava);
const firebaseExecutable = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "firebase.cmd" : "firebase",
);

if (!javaHome) {
  process.stderr.write("[test:integration] Java 11+ nao encontrado.\n");
  process.exit(1);
}
if (!existsSync(firebaseExecutable)) {
  process.stderr.write("[test:integration] Firebase CLI local nao encontrada. Execute npm ci.\n");
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH ?? ""}`,
  NODE_ENV: "test",
  FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: TEST_PROJECT_ID,
  GCLOUD_PROJECT: TEST_PROJECT_ID,
  ...(lgpdV5Only ? { NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${TEST_PROJECT_ID}.appspot.com` } : {}),
};

const child = spawn(
  firebaseExecutable,
  [
    "emulators:exec",
    "--project",
    TEST_PROJECT_ID,
    "--config",
    "firebase.test.json",
    "--only",
    lgpdV5Only ? "firestore,storage" : "firestore,auth",
    ...(vacationDocumentsOnly ? ["node --import tsx --test tests/integration/dp-vacation-documents.test.mjs"] : lgpdV5Only ? ["node --conditions=react-server --import tsx --test tests/integration/lgpd-v5-generation.test.mjs"] : [
    "node --conditions=react-server --import tsx --test --test-concurrency=1 tests/integration/cash-closure-repository.test.mjs tests/integration/dp-day-off-publication.test.mjs tests/integration/dp-journey-schedule-simulation.test.mjs tests/integration/dp-shift-reference.test.mjs tests/integration/dp-shift-swap.test.mjs tests/integration/dp-employment-reference.test.mjs tests/integration/dp-operational-unit-periods.test.mjs tests/integration/dp-rep-p.test.mjs tests/integration/dp-rep-p-availability.test.mjs tests/integration/dp-rep-p-journey-location.test.mjs tests/integration/dp-rep-p-offline.test.mjs tests/integration/dp-rep-p-month.test.mjs tests/integration/dp-time-adjustments.test.mjs tests/integration/dp-time-closure.test.mjs tests/integration/hr-document-publication.test.mjs tests/integration/system-notices.test.mjs tests/integration/pdv-sales-reconciliation.test.mjs tests/integration/financial-budgets.test.mjs tests/integration/financial-paid-beneficiary-review.test.mjs tests/integration/cash-withdrawal-classification.test.mjs tests/integration/financial-mobile-upload-cancel.test.mjs tests/integration/acquirer-fees.test.mjs tests/integration/dre-cmv-closure.test.mjs tests/integration/stone-pix-request.test.mjs tests/integration/pdv-stone-review-state.test.mjs tests/integration/replenishment-notices.test.mjs tests/integration/first-access-consumption.test.mjs && node --import tsx --test --test-concurrency=1 tests/integration/dp-rep-p-api-security.test.mjs tests/integration/collaborator-contract-periods.test.mjs tests/integration/dp-absence-operational-protocol.test.mjs && node --import tsx --test --test-concurrency=1 tests/integration/reposition-request-scope.test.mjs tests/integration/privacy-permissions.test.mjs tests/integration/dp-vacation-documents.test.mjs tests/integration/collaborator-absence-preview.test.mjs tests/integration/mobile-push-devices.test.mjs tests/integration/collaborator-absence-workflow.test.mjs tests/integration/absence-tacit-approval.test.mjs tests/integration/absence-retention.test.mjs",
    ]),
  ],
  { env, shell: process.platform === "win32", stdio: "inherit" },
);

child.on("error", (error) => {
  process.stderr.write(`[test:integration] Falha ao iniciar a Firebase CLI local: ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`[test:integration] Finalizado por sinal ${signal}.\n`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
