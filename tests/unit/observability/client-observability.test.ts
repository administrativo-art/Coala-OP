import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AppErrorBoundary from "../../../src/app/error";
import { AuthContext } from "../../../src/components/auth-provider";
import { dispatchClientErrorReport } from "../../../src/hooks/use-client-error-reporter";
import { ClientErrorIngestSchema } from "../../../src/lib/observability/client-event-schema";
import { buildClientErrorPayload, isIgnoredClientError } from "../../../src/lib/observability/client";
import { createInMemoryRateLimiter } from "../../../src/lib/observability/rate-limit";

test("captura client-side ignora abort e ruído conhecido", () => {
  assert.equal(isIgnoredClientError(new DOMException("cancelled", "AbortError")), true);
  assert.equal(isIgnoredClientError(new Error("ResizeObserver loop completed")), true);
  assert.equal(isIgnoredClientError(new Error("at chrome-extension://fixture/script.js")), true);
  assert.equal(isIgnoredClientError(new Error("render failed")), false);
});

test("payload client-side é limitado, sanitizado e validado antes da ingestão", () => {
  const payload = buildClientErrorPayload({
    error: new Error("Falha de person@example.com CPF 12345678900"),
    source: "render",
    operation: "render-page",
    routeOrJob: "/dashboard/example?token=secret",
  });
  assert.ok(payload);
  assert.equal(payload.messageSanitized.includes("person@example.com"), false);
  assert.equal(payload.messageSanitized.includes("12345678900"), false);
  assert.equal(payload.routeOrJob, "/dashboard/example");
  assert.deepEqual(ClientErrorIngestSchema.parse(payload), payload);
  assert.throws(() => ClientErrorIngestSchema.parse({ ...payload, unexpected: "field" }));
});

test("rate limit local contém rajada sem Firestore ou estado externo", () => {
  const limiter = createInMemoryRateLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2 });
  assert.equal(limiter.check("user-1", 100).allowed, true);
  assert.equal(limiter.check("user-1", 200).allowed, true);
  const denied = limiter.check("user-1", 300);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.check("user-1", 1_101).allowed, true);
});

test("dispatcher envia o payload sanitizado ao endpoint autenticado e contém falha de transporte", async () => {
  const calls: Array<{ input: RequestInfo | URL; init: unknown }> = [];
  const payload = dispatchClientErrorReport({
    error: new Error("render failed for person@example.com"),
    source: "render",
    operation: "render-page",
    routeOrJob: "/dashboard/example?token=secret",
  }, {
    getToken: async () => "id-token",
    fetcher: async (input, init) => {
      calls.push({ input, init });
      throw new Error("transport unavailable");
    },
  });
  assert.ok(payload);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/observability/client-errors");
  assert.match(JSON.stringify(calls[0]?.init), /Bearer id-token/);
  assert.equal(JSON.stringify(calls[0]?.init).includes("person@example.com"), false);
});

test("dispatcher não envia evento sem sessão autenticada", async () => {
  let calls = 0;
  const payload = dispatchClientErrorReport({
    error: new Error("render without session"),
    source: "render",
    operation: "render-page",
    routeOrJob: "/login",
  }, {
    getToken: async () => null,
    fetcher: async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    },
  });
  assert.ok(payload);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});

test("Error Boundary mostra mensagem segura, referência e ação de retry", () => {
  Object.assign(globalThis, { React: { createElement } });
  const markup = renderToStaticMarkup(createElement(
    AuthContext.Provider,
    { value: { firebaseUser: null } as never },
    createElement(AppErrorBoundary, {
      error: new Error("Firestore internal stack and secret"),
      reset() {},
    }),
  ));
  assert.match(markup, /Não foi possível carregar esta área/);
  assert.match(markup, /Referência:/);
  assert.match(markup, /Tentar novamente/);
  assert.equal(markup.includes("Firestore internal"), false);
  assert.equal(markup.includes("stack"), false);
});
