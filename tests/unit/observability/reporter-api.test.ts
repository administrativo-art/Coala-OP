import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { toErrorResponse, withApiErrorHandling } from "../../../src/lib/observability/api-error";
import { AppError } from "../../../src/lib/observability/app-error";
import { StructuredConsoleSink, type ErrorSink } from "../../../src/lib/observability/error-sink";
import { reportSystemError } from "../../../src/lib/observability/reporter";
import type { SystemErrorEvent } from "../../../src/lib/observability/system-error-event";

class CaptureSink implements ErrorSink {
  readonly events: SystemErrorEvent[] = [];
  write(event: SystemErrorEvent) {
    this.events.push(event);
  }
}

test("reporter cria evento sanitizado, determinístico e evita dupla captura", () => {
  const sink = new CaptureSink();
  const error = new Error("Falha para person@example.com com CPF 12345678900");
  const first = reportSystemError({
    error,
    source: "unit-test",
    operation: "persist",
    routeOrJob: "/api/example",
    requestId: "request-1",
    metadata: { provider: "fixture", password: "secret-value" },
    environment: "test",
    release: "release-1",
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    sink,
  });
  const duplicate = reportSystemError({ error, source: "other", sink });
  assert.deepEqual(duplicate, first);
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0]?.messageSanitized.includes("person@example.com"), false);
  assert.equal(sink.events[0]?.messageSanitized.includes("12345678900"), false);
  assert.equal(sink.events[0]?.metadataSanitized.password, "[REDACTED]");
  assert.equal(sink.events[0]?.requestId, "request-1");
});

test("reporter remove query e fragmento antes de registrar a rota", () => {
  const sink = new CaptureSink();
  reportSystemError({
    error: new Error("failed"),
    source: "api",
    operation: "load",
    routeOrJob: "/api/example?token=secret#private",
    sink,
  });
  assert.equal(sink.events[0]?.routeOrJob, "/api/example");
  assert.equal(JSON.stringify(sink.events[0]).includes("secret"), false);
});

test("falha síncrona ou assíncrona do sink nunca lança para o fluxo principal", async () => {
  const syncFailure: ErrorSink = { write() { throw new Error("sink failed"); } };
  const asyncFailure: ErrorSink = { write() { return Promise.reject(new Error("sink failed async")); } };
  assert.doesNotThrow(() => reportSystemError({ error: new Error("original-1"), source: "test", sink: syncFailure }));
  assert.doesNotThrow(() => reportSystemError({ error: new Error("original-2"), source: "test", sink: asyncFailure }));
  await new Promise((resolve) => setImmediate(resolve));
});

test("sink lento, fingerprint inválido, sanitizador hostil e release desconhecida não bloqueiam o fluxo", () => {
  const never = new Promise<void>(() => undefined);
  const slowSink: ErrorSink = { write() { return never; } };
  const startedAt = performance.now();
  const reference = reportSystemError({ error: new Error("original"), source: "test", sink: slowSink });
  assert.equal(performance.now() - startedAt < 50, true);
  assert.match(reference.eventId, /^[0-9a-f-]{36}$/);

  assert.doesNotThrow(() => reportSystemError({
    error: new Error("original fingerprint"),
    source: "test",
    fingerprintFactory() { throw new Error("fingerprint failed"); },
  }));

  const hostile = new Proxy({}, { ownKeys() { throw new Error("invalid metadata"); } });
  const sink = new CaptureSink();
  assert.doesNotThrow(() => reportSystemError({ error: new Error("original metadata"), source: "test", metadata: hostile, sink }));
  assert.equal(sink.events[0]?.release, "unknown");
});

test("StructuredConsoleSink emite JSON compatível com Logging e ReportedErrorEvent", () => {
  const lines: string[] = [];
  const sink = new StructuredConsoleSink(
    { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    { K_SERVICE: "studio" },
  );
  const capture = new CaptureSink();
  reportSystemError({ error: new Error("fixture"), source: "test", sink: capture, release: "r1" });
  sink.write(capture.events[0]!);
  const payload = JSON.parse(lines[0]!);
  assert.equal(
    payload["@type"],
    "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent",
  );
  assert.equal(payload.severity, "ERROR");
  assert.equal(payload.coalaSeverity, "high");
  assert.equal(payload.eventTime, capture.events[0]?.occurredAt);
  assert.equal(payload.serviceContext.service, "studio");
  assert.equal(payload.serviceContext.version, "r1");
  assert.match(payload.message, /^Error: fixture\n/);
  assert.equal(payload.fingerprint, capture.events[0]?.fingerprint);
  assert.equal(payload["logging.googleapis.com/labels"].fingerprint, capture.events[0]?.fingerprint);
});

test("StructuredConsoleSink preserva fingerprint interno sem prometer grouping nativo", () => {
  const lines: string[] = [];
  const sink = new StructuredConsoleSink({
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
  }, {});
  const capture = new CaptureSink();
  reportSystemError({ error: "falha sem stack", source: "worker", sink: capture, release: "unknown" });
  sink.write(capture.events[0]!);

  const payload = JSON.parse(lines[0]!);
  assert.equal(payload.serviceContext.service, "worker");
  assert.equal(payload.message, "UnknownError: falha sem stack");
  assert.match(payload.fingerprint, /^err-v1-[0-9a-f]{16}$/);
  assert.equal(payload.fingerprint, payload["logging.googleapis.com/labels"].fingerprint);
});

test("erro esperado usa envelope seguro sem eventId", async () => {
  const error = new AppError({
    code: "INVALID_INPUT",
    kind: "VALIDATION",
    safeMessage: "Revise os campos informados.",
    cause: new Error("mensagem interna"),
  });
  const response = toErrorResponse(error, "request-1", undefined, { source: "api", routeOrJob: "/api/example" });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), "request-1");
  assert.deepEqual(payload, {
    error: { code: "INVALID_INPUT", message: "Revise os campos informados.", requestId: "request-1" },
  });
  assert.equal(JSON.stringify(payload).includes("mensagem interna"), false);
});

test("erro inesperado retorna eventId sem stack nem error.message bruto", async () => {
  const sink = new CaptureSink();
  const response = toErrorResponse(
    new Error("Firestore secret detail"),
    "request-2",
    "flow-2",
    { source: "api", routeOrJob: "/api/example", sink },
  );
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.match(payload.error.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(payload).includes("Firestore secret detail"), false);
  assert.equal(JSON.stringify(payload).includes("stack"), false);
  assert.equal(sink.events[0]?.correlationId, "flow-2");
});

test("wrapper preserva sucesso e adiciona requestId à resposta", async () => {
  const handler = withApiErrorHandling({ source: "api", routeOrJob: "/api/example" }, async () => {
    return Response.json({ ok: true }, { status: 201 });
  });
  const response = await handler(new NextRequest("https://example.test/api/example", {
    headers: { "x-request-id": "upstream-request" },
  }), { params: Promise.resolve({}) });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-request-id"), "upstream-request");
  assert.deepEqual(await response.json(), { ok: true });
});
