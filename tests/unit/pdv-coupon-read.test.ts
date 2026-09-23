import assert from "node:assert/strict";
import test from "node:test";
import { fetchPdvCouponsReadOnly, PDV_COUPON_READ_MAX_BYTES } from "../../src/lib/integrations/pdv-coupon-read";
import { AppError } from "../../src/lib/observability/app-error";
import { reviewCoupons } from "../fixtures/pdv-stone-review";

const credentials = { company: "demo-company", token: "secret-api-marker", username: "demo-user", password: "secret-password-marker" };
const input = { filialId: "456", referenceDate: "2026-09-20" };
const json = (value: unknown) => new Response(JSON.stringify(value));
function reader(payload: unknown, calls: { url: string; init?: RequestInit }[] = []) {
  return (async (url, init) => { calls.push({ url: String(url), init }); return String(url).endsWith("/token") ? json({ access_token: "secret-bearer-marker" }) : json(payload); }) as typeof fetch;
}

test("PDV read uses established fixed endpoints, bounded day and server credentials without redirects/cache", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  assert.deepEqual(await fetchPdvCouponsReadOnly(input, { credentials, fetcher: reader(reviewCoupons, calls) }), reviewCoupons);
  assert.deepEqual(calls.map(c => c.url), ["https://api.tabletcloud.com.br/token", "https://api.tabletcloud.com.br/cupom/get/2026-09-20/2026-09-20/456"]);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(new URLSearchParams(String(calls[0].init?.body)).get("grant_type"), "password");
  assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer secret-bearer-marker");
  for (const call of calls) { assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.redirect, "manual"); assert.ok(call.init?.signal); }
});

test("PDV reader accepts explicit arrays/data arrays but rejects unknown/paginated/error envelopes", async () => {
  for (const payload of [[], { data: [] }, { data: reviewCoupons }]) {
    const result = await fetchPdvCouponsReadOnly(input, { credentials, fetcher: reader(payload) });
    assert.ok(Array.isArray(result));
  }
  for (const payload of [{}, null, { data: null }, { data: {}, error: "secret" }, { data: [], next: "page2" },
    { data: [], total: 500 }, [null], Array.from({ length: 501 }, () => ({}))]) {
    await assert.rejects(fetchPdvCouponsReadOnly(input, { credentials, fetcher: reader(payload) }), { code: "PDV_REVIEW_INVALID_RESPONSE" });
  }
});

test("PDV input, configuration and cancellation are rejected before a network call", async () => {
  const fetcher: typeof fetch = async () => assert.fail("must not fetch");
  for (const invalid of [{ ...input, filialId: "../x" }, { ...input, referenceDate: "2026-02-30" }]) {
    await assert.rejects(fetchPdvCouponsReadOnly(invalid, { credentials, fetcher }), { code: "PDV_REVIEW_INVALID_INPUT" });
  }
  for (const invalid of [{}, { ...credentials, token: "x\r\ny" }, { ...credentials, password: "" }]) {
    await assert.rejects(fetchPdvCouponsReadOnly(input, { credentials: invalid, fetcher }), { code: "PDV_REVIEW_NOT_CONFIGURED" });
  }
  await assert.rejects(fetchPdvCouponsReadOnly(input, { credentials, fetcher, signal: AbortSignal.abort() }), { code: "PDV_REVIEW_UNAVAILABLE" });
});

test("PDV HTTP errors, redirects and foreign client errors cannot disclose secrets", async () => {
  const fetchers: typeof fetch[] = [
    async () => new Response("secret-provider-body", { status: 302, headers: { location: "https://untrusted.test" } }),
    async () => new Response("secret-provider-body", { status: 401 }),
    async () => new Response("secret-provider-body", { status: 500 }),
    async () => { throw new Error("secret-password-marker"); },
    async () => { throw new AppError({ code: "FOREIGN", kind: "TRANSIENT_EXTERNAL", safeMessage: "secret-provider-body" }); },
  ];
  for (const fetcher of fetchers) await assert.rejects(fetchPdvCouponsReadOnly(input, { credentials, fetcher }), error => {
    assert.ok(error instanceof AppError); assert.doesNotMatch(JSON.stringify(error) + error.message, /secret|FOREIGN|untrusted/); return true;
  });
});

test("PDV reader enforces advertised and streamed size, invalid JSON and UTF-8", async () => {
  for (const response of [new Response("{}", { headers: { "content-length": "65537" } }),
    new Response("x".repeat(65537)), new Response("not-json"), new Response(new Uint8Array([255]))]) {
    await assert.rejects(fetchPdvCouponsReadOnly(input, { credentials, fetcher: async () => response }));
  }
  for (const advertised of [true, false]) {
    const response = new Response(new Uint8Array(PDV_COUPON_READ_MAX_BYTES + 1), advertised ? { headers: { "content-length": String(PDV_COUPON_READ_MAX_BYTES + 1) } } : undefined);
    await assert.rejects(fetchPdvCouponsReadOnly(input, { credentials, fetcher: async url => String(url).endsWith("/token") ? json({ access_token: "demo" }) : response }), { code: "PDV_REVIEW_TOO_LARGE" });
  }
});
