import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const nextCacheDir = path.join(projectRoot, ".next");

function killPort(port) {
  try {
    const output = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!output) return;

    const pids = output.split(/\s+/).filter(Boolean);
    if (pids.length === 0) return;

    execSync(`kill -9 ${pids.join(" ")}`, {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Nothing listening on the port.
  }
}

killPort(3000);

rmSync(nextCacheDir, { recursive: true, force: true });

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const child = spawn(npxCommand, ["next", "dev"], {
  stdio: "inherit",
  cwd: projectRoot,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
