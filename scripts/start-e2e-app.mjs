import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { assertFirestoreEmulatorSafety } from "../tests/helpers/firestore-emulator-safety.mjs";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
assertFirestoreEmulatorSafety({ projectId });

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("FIREBASE_AUTH_EMULATOR_HOST ausente; o E2E não pode iniciar sem o emulador de autenticação.");
}

const nextExecutable = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);
if (!existsSync(nextExecutable)) {
  throw new Error("Next.js local não encontrado. Execute npm ci.");
}

const child = spawn(nextExecutable, ["dev", "--hostname", "127.0.0.1", "--port", "3100"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "development",
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-e2e",
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  process.stderr.write(`[e2e:web] Falha ao iniciar Next.js: ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
