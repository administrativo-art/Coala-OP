import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

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
      // Continue with Homebrew fallbacks.
    }
  }

  return null;
}

function hasJava(javaHome) {
  return Boolean(javaHome && existsSync(join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")));
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

if (!javaHome) {
  console.error("[test:security:rules] Java 11+ nao encontrado.");
  console.error("Instale com: brew install openjdk");
  console.error("Ou defina JAVA_HOME apontando para um JDK valido.");
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH ?? ""}`,
};

const child = spawn(
  "firebase",
  [
    "emulators:exec",
    "--project",
    "demo-coala-security",
    "--only",
    "firestore,storage",
    "node --test tests/security/rules.test.mjs",
  ],
  {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[test:security:rules] Finalizado por sinal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
