import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  memorySessionSocketPath,
  startMemorySessionServer,
  tokenFromMemorySession,
} from "../../../scripts/financial/payment-cli-memory-session";

test("sessão reutilizável mantém token apenas em memória e restringe o socket", async () => {
  const name = `test-${randomUUID()}`;
  const email = "demo@example.invalid";
  const token = `token-${"x".repeat(40)}`;
  const session = await startMemorySessionServer({ name, email, token, ttlMs: 60_000 });
  try {
    assert.equal(session.path, memorySessionSocketPath(name));
    assert.equal((await lstat(session.path)).mode & 0o777, 0o600);
    assert.equal(await tokenFromMemorySession(name, email), token);
    assert.equal(await tokenFromMemorySession(name, email), token);
    await assert.rejects(() => tokenFromMemorySession(name, "other@example.invalid"), /recusou a conta/);
  } finally {
    await session.close();
  }
  await assert.rejects(() => lstat(session.path), { code: "ENOENT" });
});

test("sessão recusa nomes e durações fora do contrato", async () => {
  assert.throws(() => memorySessionSocketPath("../unsafe"), /inválido/);
  await assert.rejects(() => startMemorySessionServer({
    name: `test-${randomUUID()}`,
    email: "demo@example.invalid",
    token: "x".repeat(40),
    ttlMs: 1,
  }), /entre 1 e 60 minutos/);
});
