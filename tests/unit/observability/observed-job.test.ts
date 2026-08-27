import assert from "node:assert/strict";
import test from "node:test";

import type { ErrorSink } from "../../../src/lib/observability/error-sink";
import { runObservedJob, type JobObservation } from "../../../src/lib/observability/observed-job";
import type { SystemErrorEvent } from "../../../src/lib/observability/system-error-event";

test("runObservedJob registra duração e resultado sem alterar retorno", async () => {
  const observations: JobObservation[] = [];
  const ticks = [100, 145];
  const result = await runObservedJob({
    source: "job",
    operation: "sync",
    routeOrJob: "fixture-job",
    now: () => ticks.shift() ?? 145,
    onObservation: (observation) => { observations.push(observation); },
  }, async () => "ok");
  assert.equal(result, "ok");
  assert.equal(observations[0]?.durationMs, 45);
  assert.equal(observations[0]?.result, "success");
});

test("runObservedJob captura apenas falha terminal e relança a falha original", async () => {
  const events: SystemErrorEvent[] = [];
  const sink: ErrorSink = { write(event) { events.push(event); } };
  const original = new Error("terminal");
  await assert.rejects(() => runObservedJob({
    source: "job",
    operation: "sync",
    routeOrJob: "fixture-job",
    errorCode: "JOB_TERMINAL_FAILURE",
    errorKind: "PERMANENT_EXTERNAL",
    retryAttempt: 3,
    isTerminal: true,
    sink,
  }, async () => { throw original; }), (error) => error === original);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.retryAttempt, 3);

  await assert.rejects(() => runObservedJob({
    source: "job",
    operation: "sync",
    routeOrJob: "fixture-job",
    isTerminal: false,
    sink,
  }, async () => { throw new Error("retry"); }));
  assert.equal(events.length, 1);
});
