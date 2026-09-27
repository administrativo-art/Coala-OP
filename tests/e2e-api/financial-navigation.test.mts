import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { assertNoFirebaseTestCredentials } from "../helpers/firestore-emulator-safety.mjs";

// HTTP only: no browser, authentication, SDK reads or financial writes.
// Run after npm run build, in an isolated worktree without environment files.
test("HTTP: links financeiros antigos preservam sessão, cartão e contexto", { timeout: 90_000 }, async t => {
  assertNoFirebaseTestCredentials();
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    assert.equal(existsSync(file), false, `Use worktree sem ${file}.`);
  }
  assert.ok(existsSync(".next/BUILD_ID"), "Execute npm run build antes do teste HTTP.");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", FIREBASE_PROJECT_ID: "demo-coala-financial-navigation", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-coala-financial-navigation", GOOGLE_CLOUD_PROJECT: "demo-coala-financial-navigation", GCLOUD_PROJECT: "demo-coala-financial-navigation" },
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-3000); });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    const timeout = setTimeout(() => server.kill("SIGKILL"), 5_000);
    try { await exited; } finally { clearTimeout(timeout); }
  });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    assert.equal(server.exitCode, null, logs);
    try {
      const response = await fetch(`${origin}/dashboard/financial/reconciliation/bank-statements`, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* The local process may still be starting. */ }
    await delay(500);
  }
  assert.ok(ready, `Servidor local não iniciou: ${logs}`);
  const cases = [
    ["expenses?view=audits&session=s1&ledger=credit_card%3Ac1&unit=u1", "reconciliation/bank-statements", { session: "s1", ledger: "credit_card:c1", returnTo: "/dashboard/financial/expenses?unit=u1" }],
    ["expenses/import?session=s2&ledger=credit_card%3Ac2", "reconciliation/bank-statements", { session: "s2", ledger: "credit_card:c2" }],
    ["expenses/card-statements?month=2026-09&accountId=a1&paymentMethodId=c1", "reconciliation/card-statements", { month: "2026-09", accountId: "a1", paymentMethodId: "c1" }],
  ] as const;
  for (const [source, destination, params] of cases) {
    // App Router's RSC protocol exposes redirect() even when the unauthenticated
    // client layout does not render children. This does not test browser login.
    const response = await fetch(`${origin}/dashboard/financial/${source}`, { headers: { RSC: "1" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    let location = response.headers.get("location");
    if (response.status === 200) {
      const payload = await response.text();
      const digests = [...payload.matchAll(/^[0-9a-f]+:E(\{[^\n]+\})$/gm)]
        .map(match => JSON.parse(match[1]).digest as string | undefined);
      const redirect = digests.find(digest => digest?.startsWith("NEXT_REDIRECT;"));
      const marker = redirect?.match(/^NEXT_REDIRECT;(?:replace|push);(.+);(?:307|308);$/);
      assert.ok(marker, `${source}: resposta 200 sem intenção de redirecionamento Next`);
      location = marker[1];
    } else {
      assert.ok([307, 308].includes(response.status), `${source}: HTTP ${response.status}`);
    }
    assert.ok(location, `${source}: destino ausente`);
    const url = new URL(location, origin);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, `/dashboard/financial/${destination}`);
    for (const [key, value] of Object.entries(params)) assert.equal(url.searchParams.get(key), value);
    assert.equal(url.searchParams.get("view"), null);
    const target = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    assert.equal(target.status, 200, `${destination}: HTTP ${target.status}`);
  }
});
