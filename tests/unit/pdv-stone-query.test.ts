import assert from "node:assert/strict";
import test from "node:test";
import { queryDailySales, requireStoredPdvFilial, type SalesReviewBinding } from "../../src/features/financial/sales-reconciliation/query";
import { fetchPdvCouponsReadOnly } from "../../src/lib/integrations/pdv-coupon-read";
import { fetchStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-transport";
import { readSalesReviewBody } from "../../src/features/financial/sales-reconciliation/request-body";
import { salesBinding, salesRequest, reviewCoupons, reviewXml } from "../fixtures/pdv-stone-review";

const context = { isDefaultAdmin: true, workspace_id: "coala" };
const deps = () => ({ resolveBinding: async () => structuredClone(salesBinding) as SalesReviewBinding,
  readPdv: async () => reviewCoupons, readStone: async () => reviewXml, now: () => new Date("2026-09-22T12:00:00Z") });

test("authorized daily query combines both real transport adapters, parser and matcher without financial writes", async () => {
  const calls: string[] = [];
  let resolutions = 0;
  const result = await queryDailySales(salesRequest, context, { ...deps(),
    resolveBinding: async () => { resolutions++; return structuredClone(salesBinding); },
    readPdv: input => fetchPdvCouponsReadOnly(input, { credentials: { company: "demo", token: "demo", username: "demo", password: "demo" },
      fetcher: async url => { calls.push(String(url)); return new Response(JSON.stringify(String(url).endsWith("/token") ? { access_token: "demo" } : reviewCoupons)); } }),
    readStone: input => fetchStoneAgendaXml(input, { apiKey: "demo", fetcher: async url => { calls.push(String(url)); return new Response(reviewXml); } }),
  });
  assert.equal(resolutions, 2); assert.equal(calls.length, 3);
  assert.equal(result.pdvFilialId, salesBinding.pdvFilialId);
  assert.equal(result.mappingId, salesRequest.mappingId);
  assert.equal(result.cases.length, 1); assert.equal(result.cases[0].reviewStatus, "pending_review");
  assert.equal(result.bankReceiptConfirmed, false); assert.equal(result.coverage, "partial");
});

test("authorization, invalid scope and unpublished days fail before any binding or provider access", async () => {
  const never = async (): Promise<never> => assert.fail("no access allowed");
  const dependencies = { ...deps(), resolveBinding: never, readPdv: never, readStone: never };
  await assert.rejects(queryDailySales(salesRequest, { ...context, isDefaultAdmin: false }, dependencies), { code: "SALES_REVIEW_FORBIDDEN" });
  for (const value of [{ ...salesRequest, referenceDate: "2026-02-30" }, { ...salesRequest, workspaceId: "other" },
    { ...salesRequest, kioskId: "../other" }, { ...salesRequest, mappingId: "" }, { ...salesRequest, stoneCode: "00123" }]) {
    await assert.rejects(queryDailySales(value, context, dependencies), { code: "SALES_REVIEW_INVALID_REQUEST" });
  }
  await assert.rejects(queryDailySales({ ...salesRequest, referenceDate: "2026-09-22" }, context, dependencies), { code: "SALES_REVIEW_NOT_PUBLISHED" });
  await assert.rejects(queryDailySales(salesRequest, context, { ...dependencies, now: () => new Date("2026-09-21T07:59:59Z") }), { code: "SALES_REVIEW_NOT_PUBLISHED" });
});

test("stored filial is required: legacy fallback and another workspace never authorize PDV collection", () => {
  for (const value of [undefined, { id: "tirirical" }, { pdvFilialId: "../x" }, { pdvFilialId: "123", workspaceId: "other" }]) {
    assert.throws(() => requireStoredPdvFilial(value, "coala"), { code: "SALES_REVIEW_FILIAL_REQUIRED" });
  }
  assert.equal(requireStoredPdvFilial({ pdvFilialId: "123" }, "coala"), "123");
});

test("invalid, foreign, stale and terminal-partitioned bindings block the provider", async () => {
  for (const mapping of [{ ...salesBinding.mapping, workspaceId: "other" }, { ...salesBinding.mapping, kioskId: "other" },
    { ...salesBinding.mapping, id: "different" }, { ...salesBinding.mapping, terminalIds: ["partition"] },
    { ...salesBinding.mapping, validTo: "2026-09-19" }]) {
    await assert.rejects(queryDailySales(salesRequest, context, { ...deps(), resolveBinding: async () => ({ ...salesBinding, mapping }),
      readPdv: async () => assert.fail("must not read"), readStone: async () => assert.fail("must not read") }));
  }
});

test("binding or stored filial changed during collection invalidates the entire response", async () => {
  for (const changed of [{ ...salesBinding, pdvFilialId: "999" }, { ...salesBinding, mapping: { ...salesBinding.mapping, accountId: "changed" } }]) {
    let calls = 0;
    await assert.rejects(queryDailySales(salesRequest, context, { ...deps(), resolveBinding: async () => ++calls === 1 ? salesBinding : changed }), { code: "SALES_REVIEW_BINDING_CHANGED" });
    assert.equal(calls, 2);
  }
});

test("missing or corrupt sources are errors, not successful empty comparisons", async () => {
  await assert.rejects(queryDailySales(salesRequest, context, { ...deps(), readPdv: async () => null }));
  await assert.rejects(queryDailySales(salesRequest, context, { ...deps(), readStone: async () => "" }));
  const controller = new AbortController();
  await assert.rejects(queryDailySales(salesRequest, context, { ...deps(), signal: controller.signal,
    readPdv: async () => { controller.abort(); return reviewCoupons; } }));
});

test("request body is byte-bounded and rejects malformed JSON, malformed UTF-8 and aborted reads", async () => {
  const request = (body: BodyInit, headers?: HeadersInit) => new Request("http://localhost", { method: "POST", body, headers });
  assert.deepEqual(await readSalesReviewBody(request(JSON.stringify(salesRequest))), salesRequest);
  for (const body of ["not json", "x".repeat(2049), new Uint8Array([255]), JSON.stringify({ x: "é".repeat(1024) })]) {
    await assert.rejects(readSalesReviewBody(request(body)), { code: "SALES_REVIEW_INVALID_BODY" });
  }
  await assert.rejects(readSalesReviewBody(request("{}", { "content-length": "2049" })), { code: "SALES_REVIEW_INVALID_BODY" });
  await assert.rejects(readSalesReviewBody(new Request("http://localhost", { method: "POST", body: "{}", signal: AbortSignal.abort() })), { code: "SALES_REVIEW_INVALID_BODY" });
});
