import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  groupTriageEvents,
  normalizeTriageEvents,
  runErrorTriage,
} from "../../../.agents/skills/coala-error-triage/scripts/triage-errors.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-error-triage-"));
  mkdirSync(join(root, ".ai-work", "error-triage"), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("normaliza, sanitiza e agrupa ocorrências pelo fingerprint", () => {
  const fingerprint = "err-v1-0123456789abcdef";
  const events = normalizeTriageEvents([
    {
      eventId: "event-1",
      occurredAt: "2026-08-25T10:00:00.000Z",
      errorCode: "API_FAILED",
      errorKind: "UNEXPECTED_APPLICATION",
      severity: "high",
      source: "api",
      operation: "load",
      routeOrJob: "/api/example?token=secret",
      environment: "production",
      release: "r1",
      fingerprint,
      message: "Falha para person@example.com CPF 12345678900",
    },
    {
      eventId: "event-2",
      occurredAt: "2026-08-26T10:00:00.000Z",
      errorCode: "API_FAILED",
      errorKind: "UNEXPECTED_APPLICATION",
      severity: "high",
      source: "api",
      operation: "load",
      routeOrJob: "/api/example",
      environment: "production",
      release: "r2",
      fingerprint,
      message: "Falha repetida",
    },
  ]);
  assert.equal(events[0]?.messageSanitized.includes("person@example.com"), false);
  assert.equal(events[0]?.routeOrJob, "/api/example");
  const groups = groupTriageEvents(events, []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.classification, "HIGH");
  assert.equal(groups[0]?.status, "NEW");
  assert.equal(groups[0]?.occurrenceCount, 2);
  assert.deepEqual(groups[0]?.releases, ["r1", "r2"]);
});

test("incidentes financeiros e dados incompletos recebem prioridade adequada", () => {
  const normalized = normalizeTriageEvents([
    {
      occurredAt: "2026-08-26T10:00:00.000Z",
      errorCode: "PAYMENT_DUPLICATED",
      errorKind: "FINANCIAL_INCIDENT",
      severity: "medium",
      source: "job",
      operation: "pay",
    },
    { message: "sem contrato suficiente" },
  ]);
  const groups = groupTriageEvents(normalized, []);
  assert.equal(groups.some((group: { classification: string }) => group.classification === "CRITICAL"), true);
  assert.equal(groups.some((group: { classification: string }) => group.classification === "AMBIGUOUS"), true);
});

test("recorrência e regressão exigem ocorrência posterior ao fix", () => {
  const fingerprint = "err-v1-fedcba9876543210";
  const events = normalizeTriageEvents([
    {
      occurredAt: "2026-08-26T12:00:00.000Z",
      errorCode: "SYNC_FAILED",
      errorKind: "PERMANENT_EXTERNAL",
      severity: "high",
      source: "job",
      operation: "sync",
      release: "r2",
      fingerprint,
    },
  ]);
  const regression = groupTriageEvents(events, [{
    fingerprint,
    state: "closed",
    fixedAt: "2026-08-26T11:00:00.000Z",
    fixedRelease: "r1",
  }]);
  assert.equal(regression[0]?.status, "REGRESSION");

  const historical = groupTriageEvents(events, [{
    fingerprint,
    state: "closed",
    fixedAt: "2026-08-27T11:00:00.000Z",
    fixedRelease: "r1",
  }]);
  assert.equal(historical[0]?.status, "RESOLVED");
});

test("preflight não escreve e execução cria somente artifacts locais", (t) => {
  const root = fixture(t);
  const input = join(root, "events.jsonl");
  writeFileSync(input, JSON.stringify({
    eventId: "event-1",
    occurredAt: "2026-08-26T12:00:00.000Z",
    errorCode: "API_FAILED",
    errorKind: "UNEXPECTED_APPLICATION",
    severity: "high",
    source: "api",
    operation: "load",
    routeOrJob: "/api/example",
    environment: "production",
    release: "r1",
    fingerprint: "err-v1-0123456789abcdef",
    message: "person@example.com",
  }));
  const output = join(root, ".ai-work", "error-triage", "20260826-120000");
  const preflight = runErrorTriage({ repositoryRoot: root, inputPath: input, outputDirectory: output, dryRun: true });
  assert.equal(preflight.dryRun, true);
  assert.equal(existsSync(output), false);

  const result = runErrorTriage({ repositoryRoot: root, inputPath: input, outputDirectory: output });
  assert.equal(result.groupCount, 1);
  assert.equal(existsSync(join(output, "normalized-events.json")), true);
  assert.equal(existsSync(join(output, "groups.json")), true);
  assert.equal(existsSync(join(output, "report.md")), true);
  assert.equal(existsSync(join(output, "issue-drafts")), true);
  assert.equal(readFileSync(join(output, "normalized-events.json"), "utf8").includes("person@example.com"), false);
  assert.throws(() => runErrorTriage({ repositoryRoot: root, inputPath: input, outputDirectory: join(root, "outside") }), /\.ai-work\/error-triage/);
});
