import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { assertNoFirebaseTestCredentials } from "../tests/helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-rules";

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
      // Continue with deterministic Homebrew fallbacks.
    }
  }

  return null;
}

function hasJava(javaHome) {
  const executable = process.platform === "win32" ? "java.exe" : "java";
  return Boolean(javaHome && existsSync(join(javaHome, "bin", executable)));
}

assertNoFirebaseTestCredentials();

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
  console.error("[check:rules] Java 11+ não encontrado.");
  process.exit(1);
}

if (!existsSync(firebaseExecutable)) {
  console.error("[check:rules] Firebase CLI local não encontrada. Execute npm ci.");
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH ?? ""}`,
  GCLOUD_PROJECT: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
};

const child = spawn(
  firebaseExecutable,
  [
    "emulators:exec",
    "--project",
    projectId,
    "--config",
    "firebase.test.json",
    "--only",
    "firestore",
    "node --test tests/security/firestore.rules.test.mjs",
  ],
  {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error("[check:rules] Falha ao iniciar a Firebase CLI local:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[check:rules] Finalizado por sinal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
