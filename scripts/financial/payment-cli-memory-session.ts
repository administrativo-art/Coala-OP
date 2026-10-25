import { chmod, lstat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PaymentCliError } from "./payment-cli-transport";

const SESSION_NAME = /^[a-zA-Z0-9_-]{6,80}$/;
const MAX_RESPONSE_BYTES = 16 * 1024;

export function memorySessionSocketPath(name: string) {
  if (!SESSION_NAME.test(name)) throw new PaymentCliError("Nome da sessão em memória inválido.");
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 24);
  return join(tmpdir(), `cps-${digest}.sock`);
}

async function removeSocket(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function startMemorySessionServer(input: {
  name: string;
  email: string;
  token: string;
  ttlMs: number;
}) {
  const path = memorySessionSocketPath(input.name);
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 60_000 || input.ttlMs > 60 * 60_000) {
    throw new PaymentCliError("A sessão em memória deve durar entre 1 e 60 minutos.");
  }
  await lstat(path).then(() => {
    throw new PaymentCliError("Já existe uma sessão com esse nome. Use outro nome.");
  }).catch((error: NodeJS.ErrnoException) => {
    if (error instanceof PaymentCliError) throw error;
    if (error.code !== "ENOENT") throw error;
  });

  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const server = createServer((socket) => {
    let request = "";
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      request += chunk.toString("utf8");
      if (request.length > 512) return socket.destroy();
      if (!request.includes("\n")) return;
      const expected = JSON.stringify({ action: "token", email: input.email.toLowerCase() });
      if (request.trim() !== expected) {
        socket.end(`${JSON.stringify({ error: "Sessão ou conta inválida." })}\n`);
        return;
      }
      socket.end(`${JSON.stringify({ email: input.email.toLowerCase(), token: input.token, expiresAt })}\n`);
    });
  });
  server.on("close", resolveClosed);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
  const timer = setTimeout(() => server.close(), input.ttlMs);
  timer.unref();

  let closing = false;
  async function close() {
    if (closing) return closed;
    closing = true;
    clearTimeout(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await removeSocket(path);
  }
  closed.finally(() => removeSocket(path).catch(() => undefined));
  return { path, expiresAt, closed, close };
}

export async function tokenFromMemorySession(name: string, email: string) {
  const path = memorySessionSocketPath(name);
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(path);
    let response = "";
    const fail = (message: string) => {
      socket.destroy();
      reject(new PaymentCliError(message));
    };
    socket.setTimeout(5_000, () => fail("A sessão em memória não respondeu."));
    socket.on("error", () => fail("Sessão em memória indisponível ou encerrada."));
    socket.on("connect", () => socket.write(`${JSON.stringify({ action: "token", email: email.toLowerCase() })}\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) fail("Resposta inválida da sessão em memória.");
    });
    socket.on("end", () => {
      try {
        const payload = JSON.parse(response) as { email?: unknown; token?: unknown; expiresAt?: unknown; error?: unknown };
        if (payload.email !== email.toLowerCase() || typeof payload.token !== "string" || payload.token.length < 20) {
          throw new Error("invalid");
        }
        if (typeof payload.expiresAt !== "string" || Date.parse(payload.expiresAt) <= Date.now()) throw new Error("expired");
        resolve(payload.token);
      } catch {
        reject(new PaymentCliError("A sessão em memória recusou a conta ou expirou."));
      }
    });
  });
}
