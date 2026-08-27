import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("piloto de API usa envelope central sem expor error.message ou stack", async () => {
  const route = await source("src/app/api/products/route.ts");
  assert.match(route, /withApiErrorHandling/);
  assert.match(route, /AUTHENTICATION_REQUIRED/);
  assert.doesNotMatch(route, /error\s*\.\s*message/);
  assert.doesNotMatch(route, /NextResponse\s*\.\s*json\s*\([\s\S]{0,500}?\bstack\b/);
});

test("piloto de job propaga IDs e reporta somente a falha terminal", async () => {
  const route = await source("src/app/api/jobs/inter/cobrancas/reconcile/route.ts");
  assert.match(route, /withApiErrorHandling/);
  assert.match(route, /runObservedJob/);
  assert.match(route, /requestId:\s*observation\.requestId/);
  assert.match(route, /correlationId:\s*observation\.correlationId/);
  assert.match(route, /isTerminal:\s*true/);
});

test("ingestão do navegador é autenticada, limitada e não usa Firestore", async () => {
  const route = await source("src/app/api/observability/client-errors/route.ts");
  assert.match(route, /verifyAuth/);
  assert.match(route, /ClientErrorIngestSchema/);
  assert.match(route, /createInMemoryRateLimiter/);
  assert.doesNotMatch(route, /getFirestore|collection\(|getDocs|onSnapshot/);
});

test("observer global fica dentro do AuthProvider", async () => {
  const providers = await source("src/components/app-providers.tsx");
  assert.match(providers, /<AuthProvider>[\s\S]{0,120}<ClientErrorObserver\s*\/>/);
});
