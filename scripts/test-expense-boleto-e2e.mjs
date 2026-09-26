import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { FIREBASE_TEST_CREDENTIAL_ENV_KEYS } from "../tests/helpers/firestore-emulator-safety.mjs";
if (FIREBASE_TEST_CREDENTIAL_ENV_KEYS.some(key => process.env[key])) throw new Error("Remova credenciais reais antes do E2E.");
const projectId = "demo-coala-boleto";
let java = process.env.JAVA_HOME;
if (!java && process.platform === "darwin") {
  try { java = execFileSync("/usr/libexec/java_home", ["-v", "11+"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Homebrew fallback below. */ }
}
java ||= ["/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home", "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"].find(path => existsSync(`${path}/bin/java`));
if (!java || !existsSync(`${java}/bin/java`)) throw new Error("Java 11+ é necessário.");
const child = spawn("node_modules/.bin/firebase", ["emulators:exec", "--project", projectId, "--config", "firebase.boleto-e2e.json", "--only", "auth,firestore,storage", "node --import tsx --test tests/e2e-api/expense-boleto.test.mts"], {
  stdio: "inherit", env: { ...process.env, JAVA_HOME: java, PATH: `${java}/bin:${process.env.PATH}`, NODE_ENV: "test", FIREBASE_PROJECT_ID: projectId, NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${projectId}.firebasestorage.app`, GOOGLE_CLOUD_PROJECT: projectId, GCLOUD_PROJECT: projectId, NEXT_PUBLIC_WORKSPACE_ID: "coala", NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true", NEXT_DIST_DIR: ".next-boleto-e2e" },
});
child.on("exit", code => process.exit(code ?? 1));
child.on("error", () => process.exit(1));
