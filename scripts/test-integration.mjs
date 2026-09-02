import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { FIREBASE_TEST_CREDENTIAL_ENV_KEYS } from "../tests/helpers/firestore-emulator-safety.mjs";

const TEST_PROJECT_ID = "demo-coala-repository";

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
    "firestore",
    "node --conditions=react-server --import tsx --test tests/integration/cash-closure-repository.test.mjs tests/integration/dp-day-off-publication.test.mjs",
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
