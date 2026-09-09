import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { FIREBASE_TEST_CREDENTIAL_ENV_KEYS } from "../tests/helpers/firestore-emulator-safety.mjs";

const TEST_PROJECT_ID = "demo-coala-e2e";

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
      // Continua para os fallbacks locais abaixo.
    }
  }
  return null;
}

function hasJava(javaHome) {
  return Boolean(javaHome && existsSync(join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")));
}

const credentialKey = FIREBASE_TEST_CREDENTIAL_ENV_KEYS.find((key) => Boolean(process.env[key]));
if (credentialKey) {
  process.stderr.write(`[test:e2e] ${credentialKey} deve estar ausente; o teste usa somente emuladores.\n`);
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
  process.stderr.write("[test:e2e] Java 11+ não encontrado.\n");
  process.exit(1);
}
if (!existsSync(firebaseExecutable)) {
  process.stderr.write("[test:e2e] Firebase CLI local não encontrada. Execute npm ci.\n");
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH ?? ""}`,
  NODE_ENV: "test",
  FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
  NEXT_PUBLIC_WORKSPACE_ID: "coala",
  GOOGLE_CLOUD_PROJECT: TEST_PROJECT_ID,
  GCLOUD_PROJECT: TEST_PROJECT_ID,
  NEXT_DIST_DIR: ".next-e2e",
};

const child = spawn(
  firebaseExecutable,
  [
    "emulators:exec",
    "--project",
    TEST_PROJECT_ID,
    "--config",
    "firebase.e2e.json",
    "--only",
    "auth,firestore",
    "npm run test:e2e:playwright",
  ],
  { env, shell: process.platform === "win32", stdio: "inherit" },
);

child.on("error", (error) => {
  process.stderr.write(`[test:e2e] Falha ao iniciar a Firebase CLI local: ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`[test:e2e] Finalizado por sinal ${signal}.\n`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
