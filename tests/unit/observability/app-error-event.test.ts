import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../src/lib/observability/app-error";
import { createErrorFingerprint } from "../../../src/lib/observability/fingerprint";
import { generateEventId, normalizeOpaqueId, resolveCorrelationId, resolveRequestId } from "../../../src/lib/observability/ids";
import { sanitizeError } from "../../../src/lib/observability/sanitize";
import { SystemErrorEventSchema } from "../../../src/lib/observability/system-error-event";

test("AppError aplica defaults da taxonomia sem tornar cause público", () => {
  const cause = new Error("detalhe interno");
  const error = new AppError({ code: "RESOURCE_MISSING", kind: "NOT_FOUND", cause });
  assert.equal(error.httpStatus, 404);
  assert.equal(error.safeMessage, "O recurso solicitado não foi encontrado.");
  assert.equal(error.reportable, false);
  assert.equal(error.cause, cause);
  assert.throws(() => new AppError({ code: "mensagem instável", kind: "VALIDATION" }), /identificador estável/);
});

test("SystemErrorEvent valida o schema versionado", () => {
  const eventId = generateEventId();
  const parsed = SystemErrorEventSchema.parse({
    schemaVersion: 1,
    eventId,
    occurredAt: "2026-08-26T12:00:00.000Z",
    errorCode: "UNEXPECTED_ERROR",
    errorKind: "UNEXPECTED_APPLICATION",
    severity: "high",
    source: "unit-test",
    operation: "validate",
    routeOrJob: "/api/example",
    requestId: "request-1",
    environment: "test",
    release: "fixture",
    fingerprint: "err-v1-0123456789abcdef",
    errorName: "Error",
    messageSanitized: "Falha sanitizada.",
    metadataSanitized: {},
    isTerminal: true,
  });
  assert.equal(parsed.eventId, eventId);
  assert.throws(() => SystemErrorEventSchema.parse({ ...parsed, schemaVersion: 2 }));
});

test("eventId é opaco e único por ocorrência", () => {
  const first = generateEventId();
  const second = generateEventId();
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(first.includes("@"), false);
});

test("requestId aceita identificador válido, rejeita entrada abusiva e propaga correlationId somente quando presente", () => {
  const accepted = new Request("https://example.test", { headers: { "x-request-id": "upstream:123", "x-correlation-id": "flow-9" } });
  assert.equal(resolveRequestId(accepted), "upstream:123");
  assert.equal(resolveCorrelationId(accepted), "flow-9");

  const rejected = new Request("https://example.test", { headers: { "x-request-id": `bad-${"x".repeat(200)}` } });
  assert.notEqual(resolveRequestId(rejected), rejected.headers.get("x-request-id"));
  assert.equal(resolveCorrelationId(rejected), undefined);
  assert.equal(normalizeOpaqueId("line\nbreak"), undefined);
});

test("fingerprint permanece estável com UUID, document ID, query e linhas variáveis", () => {
  const common = {
    errorCode: "HR_DOCUMENT_WRITE_FAILED",
    source: "api",
    operation: "write",
    errorName: "Error",
  } as const;
  const first = createErrorFingerprint({
    ...common,
    routeOrJob: "/api/hr/documents/0f08aacf-48a0-41e9-b765-16ba8e3d7860?token=one",
    stack: "Error: cpf 123.456.789-00\n at save (/app/a.ts:10:4)",
  });
  const second = createErrorFingerprint({
    ...common,
    routeOrJob: "/api/hr/documents/7f6de737-0534-4ed3-bfad-4adc42494385?token=two",
    stack: "Error: cpf 987.654.321-00\n at save (/app/a.ts:999:88)",
  });
  assert.equal(first, second);
  assert.match(first, /^err-v1-[0-9a-f]{16}$/);

  const opaqueA = createErrorFingerprint({ ...common, routeOrJob: "/api/items/documentA1234567" });
  const opaqueB = createErrorFingerprint({ ...common, routeOrJob: "/api/items/documentB7654321" });
  assert.equal(opaqueA, opaqueB);
});

test("fingerprint continua estável depois da redação de segredos e PII", () => {
  const first = new Error("Bearer token-one para person@example.com");
  first.stack = "Error: Bearer token-one para person@example.com\n    at save (/app/service.ts:10:2)";
  const second = new Error("Bearer token-two para other@example.com");
  second.stack = "Error: Bearer token-two para other@example.com\n    at save (/app/service.ts:999:88)";
  const input = {
    errorCode: "PERSISTENCE_FAILED",
    source: "api",
    operation: "save",
    routeOrJob: "/api/example",
    errorName: "Error",
  } as const;
  assert.equal(
    createErrorFingerprint({ ...input, stack: sanitizeError(first).stack }),
    createErrorFingerprint({ ...input, stack: sanitizeError(second).stack }),
  );
});
