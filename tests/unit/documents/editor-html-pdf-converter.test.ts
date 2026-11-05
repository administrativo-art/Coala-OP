import assert from "node:assert/strict";
import test from "node:test";

import {
  convertHtmlToPdf,
  HTML_PDF_MAX_OUTPUT_BYTES,
} from "../../../src/features/documents/editor/html-pdf-converter.server";

const SECRET = "tok-segredo-123";
const BASE = "https://gotenberg.internal.example";
const env = { DOCX_TO_PDF_URL: BASE, DOCX_TO_PDF_ID_TOKEN: SECRET };
const pdfBytes = () => new Response(Buffer.from("%PDF-1.7 conteudo"));

test("sem base configurada devolve not_configured sem chamar fetch", async () => {
  let called = false;
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: { env: {}, fetch: (async () => { called = true; return pdfBytes(); }) as typeof fetch },
  });
  assert.deepEqual(r, { ok: false, reason: "not_configured" });
  assert.equal(called, false);
});

test("entrada vazia ou acima do limite é invalid_input", async () => {
  assert.deepEqual(await convertHtmlToPdf("  ", { deps: { env } }), { ok: false, reason: "invalid_input" });
  const big = "a".repeat(5 * 1024 * 1024 + 1);
  assert.deepEqual(await convertHtmlToPdf(big, { deps: { env } }), { ok: false, reason: "invalid_input" });
  assert.deepEqual(
    await convertHtmlToPdf("<p>x</p>", { paper: { widthPx: -1, heightPx: 10 }, deps: { env } }),
    { ok: false, reason: "invalid_input" },
  );
});

test("sucesso: multipart com index.html, papel e margens em polegadas e Authorization", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const r = await convertHtmlToPdf("<p>olá</p>", {
    paper: { widthPx: 794, heightPx: 1123 },
    margins: { topPx: 96, bottomPx: 48, leftPx: 96, rightPx: 96 },
    deps: {
      env,
      fetch: (async (u: URL, init: RequestInit) => {
        seenUrl = String(u);
        seenInit = init;
        return pdfBytes();
      }) as unknown as typeof fetch,
    },
  });
  assert.equal(r.ok, true);
  assert.equal(seenUrl, `${BASE}/forms/chromium/convert/html`);
  assert.equal((seenInit?.headers as Record<string, string>).Authorization, `Bearer ${SECRET}`);
  const form = seenInit?.body as FormData;
  const file = form.get("files") as File;
  assert.equal(file.name, "index.html");
  assert.equal(await file.text(), "<p>olá</p>");
  assert.equal(form.get("printBackground"), "true");
  assert.equal(form.get("paperWidth"), "8.2708");
  assert.equal(form.get("paperHeight"), "11.6979");
  assert.equal(form.get("marginTop"), "1");
  assert.equal(form.get("marginBottom"), "0.5");
  assert.equal(form.get("marginLeft"), "1");
  assert.equal(form.get("marginRight"), "1");
});

test("usa authorize injetado quando só há audience", async () => {
  let header: string | undefined;
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: {
      env: { DOCX_TO_PDF_URL: BASE, DOCX_TO_PDF_AUDIENCE: "aud" },
      authorize: async () => "Bearer abc",
      fetch: (async (_u: URL, init: RequestInit) => {
        header = (init.headers as Record<string, string>).Authorization;
        return pdfBytes();
      }) as unknown as typeof fetch,
    },
  });
  assert.equal(r.ok, true);
  assert.equal(header, "Bearer abc");
});

test("falha de autenticação é auth_failed e não chama o upstream", async () => {
  for (const authorize of [async () => { throw new Error(`falhou ${SECRET}`); }, async () => null]) {
    let called = false;
    const r = await convertHtmlToPdf("<p>x</p>", {
      deps: {
        env: { DOCX_TO_PDF_URL: BASE, DOCX_TO_PDF_AUDIENCE: "aud" },
        authorize,
        fetch: (async () => { called = true; return pdfBytes(); }) as typeof fetch,
      },
    });
    assert.deepEqual(r, { ok: false, reason: "auth_failed" });
    assert.equal(called, false);
  }
});

test("resposta sem %PDF é invalid_response", async () => {
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: { env, fetch: (async () => new Response("<html>erro</html>")) as typeof fetch },
  });
  assert.deepEqual(r, { ok: false, reason: "invalid_response" });
});

test("500 do upstream é upstream_error sem vazar corpo, URL ou token", async () => {
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: {
      env,
      fetch: (async () => new Response(`stack ${SECRET} ${BASE}`, { status: 500 })) as typeof fetch,
    },
  });
  assert.deepEqual(r, { ok: false, reason: "upstream_error" });
  const text = JSON.stringify(r);
  // Regex pelo nome do host (e não includes da URL inteira): é checagem de vazamento, não validação de URL.
  assert.ok(!text.includes(SECRET) && !/gotenberg\.internal\.example/.test(text) && !text.includes("stack"));
});

test("erro de rede com mensagem sensível vira upstream_error genérico", async () => {
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: { env, fetch: (async () => { throw new Error(`ECONNREFUSED ${BASE} ${SECRET}`); }) as typeof fetch },
  });
  assert.deepEqual(r, { ok: false, reason: "upstream_error" });
});

test("fetch que não resolve estoura timeout", async () => {
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: {
      env,
      timeoutMs: 20,
      fetch: ((_u: URL, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        })) as unknown as typeof fetch,
    },
  });
  assert.deepEqual(r, { ok: false, reason: "timeout" });
});

test("resposta acima de 50 MB é too_large", async () => {
  const big = Buffer.alloc(HTML_PDF_MAX_OUTPUT_BYTES + 1);
  big.write("%PDF");
  const r = await convertHtmlToPdf("<p>x</p>", {
    deps: { env, fetch: (async () => new Response(big)) as typeof fetch },
  });
  assert.deepEqual(r, { ok: false, reason: "too_large" });
});

test("excedente de conversões simultâneas devolve upstream_busy sem chamar o upstream e libera ao terminar", async () => {
  const { HTML_PDF_MAX_CONCURRENT } = await import("../../../src/features/documents/editor/html-pdf-converter.server");
  const releases: Array<() => void> = [];
  let calls = 0;
  const slowFetch = (() => {
    calls += 1;
    return new Promise<Response>((resolve) => releases.push(() => resolve(pdfBytes())));
  }) as unknown as typeof fetch;
  const running = Array.from({ length: HTML_PDF_MAX_CONCURRENT }, () => convertHtmlToPdf("<p>x</p>", { deps: { env, fetch: slowFetch } }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, HTML_PDF_MAX_CONCURRENT);
  const extra = await convertHtmlToPdf("<p>x</p>", { deps: { env, fetch: slowFetch } });
  assert.deepEqual(extra, { ok: false, reason: "upstream_busy" });
  assert.equal(calls, HTML_PDF_MAX_CONCURRENT);
  releases.forEach((release) => release());
  assert.ok((await Promise.all(running)).every((r) => r.ok));
  const after = await convertHtmlToPdf("<p>x</p>", { deps: { env, fetch: (async () => pdfBytes()) as typeof fetch } });
  assert.equal(after.ok, true);
});

test("falha do upstream também libera a vaga", async () => {
  for (let i = 0; i < 6; i++) {
    const r = await convertHtmlToPdf("<p>x</p>", { deps: { env, fetch: (async () => { throw new Error("x"); }) as typeof fetch } });
    assert.deepEqual(r, { ok: false, reason: "upstream_error" });
  }
});
