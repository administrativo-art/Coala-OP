import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeError, sanitizeMetadata, sanitizeValue } from "../../../src/lib/observability/sanitize";

test("sanitiza tokens, cookies, senha, documentos, conta e Pix por allowlist e redação", () => {
  const result = sanitizeMetadata({
    provider: "fixture",
    authorization: "Bearer super-secret-token-value",
    cookie: "session=sensitive",
    senha: "very-secret-password",
    cpf: "123.456.789-00",
    cnpj: "12.345.678/0001-90",
    accountNumber: "123456-7",
    pix: "person@example.com",
    unknownPayload: { email: "person@example.com" },
  });
  assert.equal(result.provider, "fixture");
  assert.equal(result.authorization, "[REDACTED]");
  assert.equal(result.cookie, "[REDACTED]");
  assert.equal(result.senha, "[REDACTED]");
  assert.equal(result.cpf, "[REDACTED]");
  assert.equal(result.cnpj, "[REDACTED]");
  assert.equal(result.accountNumber, "[REDACTED]");
  assert.equal(result.pix, "[REDACTED]");
  assert.equal(result.unknownPayload, "[OMITTED]");
});

test("sanitiza URL, query sensível, e-mail, CPF, CNPJ e stack", () => {
  const sanitized = sanitizeError(new Error(
    "POST https://api.example.test/path?token=secret para person@example.com CPF 12345678900 CNPJ 12345678000190",
  ));
  assert.equal(sanitized.message.includes("secret"), false);
  assert.equal(sanitized.message.includes("person@example.com"), false);
  assert.equal(sanitized.message.includes("12345678900"), false);
  assert.equal(sanitized.message.includes("12345678000190"), false);
  assert.equal(sanitized.stack?.includes("person@example.com"), false);
  assert.match(sanitized.stack ?? "", /^Error: POST https:\/\/api\.example\.test\/path/);
  assert.equal(sanitized.stack?.includes("\n"), true);
});

test("preserva linhas da stack e não interpreta Error como protocolo de URL", () => {
  const error = new Error("fixture");
  error.stack = "Error: fixture\n    at run (/Users/person/project/job.ts:10:2)";
  const sanitized = sanitizeError(error);
  assert.equal(
    sanitized.stack,
    "Error: fixture\n    at run (/Users/[REDACTED]/project/job.ts:10:2)",
  );
});

test("sanitiza o usuário de caminhos locais presentes na stack", () => {
  const sanitized = sanitizeError(new Error("at /Users/person/project/file.ts:1:2 and C:\\Users\\person\\project\\file.ts"));
  assert.equal(sanitized.message.includes("/Users/person"), false);
  assert.equal(sanitized.message.includes("C:\\Users\\person"), false);
  assert.match(sanitized.message, /\[REDACTED\]/);
});

test("limita objetos cíclicos, arrays e payloads gigantes", () => {
  const circular: Record<string, unknown> = { route: "/api/example" };
  circular.self = circular;
  const result = sanitizeMetadata({
    route: "/api/example",
    payload: circular,
    values: Array.from({ length: 50 }, (_, index) => index),
    reasonCode: "x".repeat(5_000),
  }, { allowedMetadataKeys: ["payload", "values"] });
  assert.deepEqual((result.values as unknown[]).length, 20);
  assert.equal((result.payload as Record<string, unknown>).self, "[CIRCULAR]");
  assert.match(String(result.reasonCode), /TRUNCATED/);
});

test("Request e Response nunca incluem body e só preservam headers permitidos", () => {
  const request = new Request("https://example.test/path?token=secret", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-token-value",
      Cookie: "session=secret",
      "Content-Type": "application/json",
      "X-Request-Id": "request-1",
    },
    body: JSON.stringify({ cpf: "12345678900" }),
  });
  const sanitizedRequest = sanitizeValue(request) as Record<string, unknown>;
  assert.equal(String(sanitizedRequest.url).includes("token"), false);
  assert.deepEqual(sanitizedRequest.headers, { "content-type": "application/json", "x-request-id": "request-1" });
  assert.equal("body" in sanitizedRequest, false);

  const sanitizedResponse = sanitizeValue(new Response("secret body", { status: 502 })) as Record<string, unknown>;
  assert.deepEqual(sanitizedResponse, { type: "Response", status: 502, statusText: "" });
});

test("snapshot Firestore é reduzido a referência sem executar data()", () => {
  let dataCalled = false;
  const result = sanitizeValue({
    id: "opaque-id",
    exists: true,
    ref: { path: "collection/opaque-id" },
    data() {
      dataCalled = true;
      return { cpf: "12345678900" };
    },
  });
  assert.equal(dataCalled, false);
  assert.deepEqual(result, {
    type: "firestore-snapshot",
    id: "opaque-id",
    path: "collection/opaque-id",
    exists: true,
  });
});

test("objeto hostil não faz o sanitizador lançar", () => {
  const hostile = new Proxy({}, { ownKeys() { throw new Error("invalid object"); } });
  assert.equal(sanitizeValue(hostile), "[OMITTED]");
  assert.deepEqual(sanitizeMetadata(hostile), {});
});
