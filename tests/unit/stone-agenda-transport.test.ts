import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/observability/app-error";
import { fetchStoneAgendaXml, STONE_AGENDA_MAX_BYTES } from "../../src/lib/integrations/stone/agenda-transport";

const input = { stoneCode: "123456789", referenceDate: "2026-09-20" };
const xml = '<Conciliation><Header><StoneCode>123456789</StoneCode></Header></Conciliation>';
const apiKey = "synthetic-test-key";
const response = (value: Response): typeof fetch => async () => value;
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, expected);
  assert.equal(error.cause, undefined);
  assert.deepEqual(error.metadata, {});
  assert.doesNotMatch(JSON.stringify(error), /synthetic-test-key|private-body|private-location/);
  return true;
};

test("Stone agenda uses fixed v2 host, one date, XML2_2 and server Basic credentials", async () => {
  let calls = 0;
  const result = await fetchStoneAgendaXml(input, { apiKey, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, "https://conciliation.stone.com.br/v2/merchant/123456789/conciliation-file/20260920?layout=XML2_2");
    assert.equal(options?.method, "GET");
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("authorization"), `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`);
    assert.equal(headers.get("x-user-type"), "client");
    assert.equal(headers.get("x-accept-redirect"), "false");
    return new Response(xml);
  } });
  assert.equal(calls, 1);
  assert.equal(result, xml);
});

test("Stone agenda rejects invalid dates and path injection before network", async () => {
  const fetcher: typeof fetch = async () => { assert.fail("network must not run"); };
  for (const value of [
    { ...input, stoneCode: "123/../../secret" },
    { ...input, stoneCode: "" },
    { ...input, referenceDate: "2026-02-29" },
    { ...input, referenceDate: "2026-09-31" },
    { ...input, referenceDate: "20260920" },
  ]) {
    await assert.rejects(fetchStoneAgendaXml(value, { apiKey, fetcher }), code("STONE_AGENDA_INVALID_INPUT"));
  }
  assert.equal(await fetchStoneAgendaXml({ ...input, referenceDate: "2024-02-29" },
    { apiKey, fetcher: response(new Response(xml)) }), xml);
});

test("Stone agenda selects XML2_4 explicitly without changing the legacy default", async () => {
  assert.equal(await fetchStoneAgendaXml(input, { apiKey, layout: "XML2_4", fetcher: async (url, options) => {
    assert.equal(url, "https://conciliation.stone.com.br/v2/merchant/123456789/conciliation-file/20260920?layout=XML2_4");
    assert.equal(new Headers(options?.headers).get("x-user-type"), "client");
    assert.equal(options?.redirect, "manual");
    return new Response(xml);
  } }), xml);
  await assert.rejects(fetchStoneAgendaXml(input, { apiKey,
    layout: "XML2_4&redirect=private-location" as "XML2_4",
    fetcher: async () => { assert.fail("invalid layout must not reach network"); },
  }), code("STONE_AGENDA_INVALID_INPUT"));
});

test("Stone agenda fails closed without usable runtime credentials", async () => {
  for (const value of [undefined, "", " ", "key\n", "key:password"]) {
    await assert.rejects(fetchStoneAgendaXml(input, {
      apiKey: value,
      fetcher: async () => { assert.fail("network must not run"); },
    }), code("STONE_AGENDA_NOT_CONFIGURED"));
  }
});

test("Stone agenda never follows redirects or forwards credentials to download URLs", async () => {
  let calls = 0;
  await assert.rejects(fetchStoneAgendaXml(input, { apiKey, fetcher: async () => {
    calls++;
    return new Response("private-body", { status: 307, headers: { location: "http://127.0.0.1/private-location" } });
  } }), code("STONE_AGENDA_REDIRECT_BLOCKED"));
  assert.equal(calls, 1);
});

test("Stone agenda errors do not turn credential failure, 404 or outage into an empty schedule", async () => {
  for (const status of [204, 400, 401, 403, 404, 429, 500, 503, 504]) {
    await assert.rejects(fetchStoneAgendaXml(input, {
      apiKey,
      fetcher: response(new Response(status === 204 ? null : "private-body", { status })),
    }), (error: unknown) => {
      code(status === 401 || status === 403 ? "STONE_AGENDA_CREDENTIAL_REJECTED" : "STONE_AGENDA_UPSTREAM_REJECTED")(error);
      assert.equal((error as AppError).retryable, status === 429 || status >= 500);
      return true;
    });
  }
});

test("Stone agenda sanitizes thrown HTTP/stream errors, including foreign AppError", async () => {
  for (const error of [new Error(apiKey), new AppError({
    code: "STONE_AGENDA_PRIVATE_BODY", kind: "TRANSIENT_EXTERNAL", metadata: { apiKey },
  })]) {
    await assert.rejects(fetchStoneAgendaXml(input, { apiKey, fetcher: async () => { throw error; } }),
      code("STONE_AGENDA_UNAVAILABLE"));
  }
  await assert.rejects(fetchStoneAgendaXml(input, { apiKey, fetcher: response(new Response(
    new ReadableStream({ start(controller) { controller.error(new Error(apiKey)); } }),
  )) }), code("STONE_AGENDA_UNAVAILABLE"));
});

test("Stone agenda bounds decompressed stream even without Content-Length", async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(fetchStoneAgendaXml(input, { apiKey, fetcher: response(new Response(stream)) }),
    code("STONE_AGENDA_TOO_LARGE"));
  assert.equal(cancelled, true);
  assert.ok(chunks <= 11);
  await assert.rejects(fetchStoneAgendaXml(input, { apiKey, fetcher: response(new Response(xml, {
    headers: { "Content-Length": String(STONE_AGENDA_MAX_BYTES + 1) },
  })) }), code("STONE_AGENDA_TOO_LARGE"));
});

test("Stone agenda rejects empty, non-XML, invalid UTF-8 and entity declarations", async () => {
  for (const body of ["", "{}", '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>',
    new Uint8Array([0xff, 0xfe])]) {
    await assert.rejects(fetchStoneAgendaXml(input, { apiKey, fetcher: response(new Response(body)) }),
      code(body === "" ? "STONE_AGENDA_EMPTY_RESPONSE" : "STONE_AGENDA_INVALID_RESPONSE"));
  }
});
