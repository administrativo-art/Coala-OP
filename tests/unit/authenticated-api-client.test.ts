import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthenticatedApiError,
  authenticatedApiRequest,
} from "../../src/lib/authenticated-api-client";

const tokenProvider = async () => "token-123";

test("transporta autenticação, headers, opções e resposta JSON", async () => {
  let receivedInit: RequestInit | undefined;
  const payload = await authenticatedApiRequest<{ ok: boolean }>("/api/example", {
    method: "GET",
    credentials: "same-origin",
    cache: "reload",
    headers: { "X-Request-Id": "request-1" },
    getIdToken: tokenProvider,
    fetchImpl: async (_input, init) => {
      receivedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(receivedInit?.method, "GET");
  assert.equal(receivedInit?.credentials, "same-origin");
  assert.equal(receivedInit?.cache, "reload");
  const headers = new Headers(receivedInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer token-123");
  assert.equal(headers.get("X-Request-Id"), "request-1");
});

test("serializa body JSON e define Content-Type somente para json", async () => {
  let receivedInit: RequestInit | undefined;
  await authenticatedApiRequest("/api/example", {
    method: "POST",
    json: { value: 42 },
    getIdToken: tokenProvider,
    fetchImpl: async (_input, init) => {
      receivedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(receivedInit?.body, JSON.stringify({ value: 42 }));
  assert.equal(new Headers(receivedInit?.headers).get("Content-Type"), "application/json");
});

test("preserva FormData sem forçar Content-Type", async () => {
  const form = new FormData();
  form.append("file", new Blob(["documento"]), "document.txt");
  let receivedInit: RequestInit | undefined;
  await authenticatedApiRequest("/api/upload", {
    method: "POST",
    body: form,
    getIdToken: tokenProvider,
    fetchImpl: async (_input, init) => {
      receivedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(receivedInit?.body, form);
  assert.equal(new Headers(receivedInit?.headers).has("Content-Type"), false);
});

test("normaliza erro JSON com status e payload", async () => {
  await assert.rejects(
    () => authenticatedApiRequest("/api/example", {
      getIdToken: tokenProvider,
      fetchImpl: async () => new Response(JSON.stringify({ error: "Operação recusada." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthenticatedApiError);
      assert.equal(error.message, "Operação recusada.");
      assert.equal(error.status, 422);
      assert.deepEqual(error.payload, { error: "Operação recusada." });
      return true;
    },
  );
});

test("normaliza erro não JSON sem expor o corpo como mensagem", async () => {
  await assert.rejects(
    () => authenticatedApiRequest("/api/example", {
      fallbackError: "Falha controlada.",
      getIdToken: tokenProvider,
      fetchImpl: async () => new Response("upstream indisponível", { status: 502 }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthenticatedApiError);
      assert.equal(error.message, "Falha controlada. (HTTP 502)");
      assert.equal(error.payload, "upstream indisponível");
      return true;
    },
  );
});

test("retorna texto em sucesso não JSON e undefined em 204", async () => {
  const textPayload = await authenticatedApiRequest<string>("/api/text", {
    getIdToken: tokenProvider,
    fetchImpl: async () => new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } }),
  });
  const emptyPayload = await authenticatedApiRequest<undefined>("/api/empty", {
    getIdToken: tokenProvider,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  assert.equal(textPayload, "ok");
  assert.equal(emptyPayload, undefined);
});

test("preserva AbortSignal e propaga cancelamento", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => authenticatedApiRequest("/api/slow", {
      signal: controller.signal,
      getIdToken: tokenProvider,
      fetchImpl: async (_input, init) => {
        assert.equal(init?.signal, controller.signal);
        throw new DOMException("Aborted", "AbortError");
      },
    }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});

test("aborta antes do fetch quando a sessão não fornece token", async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => authenticatedApiRequest("/api/example", {
      getIdToken: async () => null,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response();
      },
    }),
    (error: unknown) => error instanceof AuthenticatedApiError
      && error.status === 401
      && error.message === "Sessão não disponível.",
  );
  assert.equal(fetchCalled, false);
});

test("rejeita json e body simultâneos", async () => {
  await assert.rejects(
    () => authenticatedApiRequest("/api/example", {
      json: { ok: true },
      body: "duplicado",
      getIdToken: tokenProvider,
    }),
    /apenas uma das opções/,
  );
});
