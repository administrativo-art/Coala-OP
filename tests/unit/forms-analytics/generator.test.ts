import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  cancelOccurrencesForExecution,
  generateOccurrencesForExecution,
  GenerationInProgressError,
  supersedeOccurrencesForExecution,
  type GenerateOccurrencesParams,
  type GeneratorDeps,
} from "../../../src/features/forms/analytics/generator";
import type {
  ExecutionView,
  GenerationLookups,
} from "../../../src/features/forms/analytics/generator-core";
import type { AnalyticsItemView } from "../../../src/features/forms/analytics/analytics-config-schema";
import { ANALYTICS_COLLECTIONS } from "../../../src/features/forms/analytics/types";
import { FakeFirestore } from "./fake-firestore";

const EXECUTIONS = "form_executions";

const lookups: GenerationLookups = {
  domains: new Map([["dom_manutencao", { name: "Manutenção", is_active: true }]]),
  criteria: new Map([
    [
      "quesito_porta",
      { name: "Porta", domain_id: "dom_manutencao", is_active: true },
    ],
  ]),
  results: new Map([
    [
      "res_conforme",
      {
        name: "Conforme",
        polarity: "positive",
        counts_as_evaluation: true,
        counts_as_occurrence: false,
        counts_as_non_conformity: false,
        is_active: true,
      },
    ],
    [
      "res_manutencao",
      {
        name: "Manutenção necessária",
        polarity: "negative",
        counts_as_evaluation: true,
        counts_as_occurrence: true,
        counts_as_non_conformity: true,
        is_active: true,
      },
    ],
  ]),
  freeTargets: new Map(),
};

const items: AnalyticsItemView[] = [
  {
    id: "p1",
    type: "yes_no",
    title: "Porta 09 está funcionando?",
    analytics_config: {
      enabled: true,
      domain_id: "dom_manutencao",
      criterion_id: "quesito_porta",
      target_type: "unit",
      target_source: "execution_unit",
      occurrence_mode: "single",
      occurrence_condition: { operator: "equals", value: false },
      evaluation_mode: "positive_and_negative",
      positive_result_id: "res_conforme",
      negative_result_id: "res_manutencao",
      resolution_behavior: "auto_resolve_on_task_completion",
    },
  },
];

const execution: ExecutionView = {
  id: "exec_1",
  workspace_id: "ws1",
  template_id: "tpl_1",
  template_version: 1,
  completed_at: new Date("2026-07-03T18:00:00Z"),
  unit_id: "unit_a",
  unit_name: "Unidade A",
  answers: new Map([["p1", { value: false }]]),
};

function buildParams(requestId: string): GenerateOccurrencesParams {
  return {
    execution,
    items,
    lookups,
    workspaceTimezone: "America/Belem",
    userId: "user_1",
    requestId,
    mode: "complete",
  };
}

let db: FakeFirestore;
let deps: GeneratorDeps;

beforeEach(() => {
  db = new FakeFirestore();
  db.seed(EXECUTIONS, "exec_1", { analytics_revision: 0 });
  deps = {
    db: db as unknown as Firestore,
    executionsCollection: EXECUTIONS,
  };
});

describe("revisão, lock e idempotência (28.1)", () => {
  test("primeiro complete: revisão 0 → 1, estado generated, registros escritos", async () => {
    const report = await generateOccurrencesForExecution(deps, buildParams("req_1"));

    assert.equal(report.analytics_revision, 1);
    assert.equal(report.written, 1);

    const executionDoc = db.docData(EXECUTIONS, "exec_1")!;
    assert.equal(executionDoc.analytics_revision, 1);
    assert.equal(executionDoc.analytics_generation_state, "generated");

    const occurrences = db.allDocs(ANALYTICS_COLLECTIONS.occurrences);
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].is_current, true);
    assert.equal(occurrences[0].record_status, "valid");
    assert.equal(occurrences[0].resolution_status, "open");
    assert.equal(occurrences[0].analytics_revision, 1);
  });

  test("retry técnico (mesmo request_id) não incrementa revisão nem duplica", async () => {
    await generateOccurrencesForExecution(deps, buildParams("req_1"));
    // simula processo que morreu depois de adquirir o lock
    await db
      .collection(EXECUTIONS)
      .doc("exec_1")
      .update({
        analytics_generation_state: "generating",
        analytics_generation_lock_id: "req_1",
        analytics_generation_lock_at: Timestamp.now(),
      });

    const report = await generateOccurrencesForExecution(deps, buildParams("req_1"));

    assert.equal(report.analytics_revision, 1);
    assert.equal(db.allDocs(ANALYTICS_COLLECTIONS.occurrences).length, 1);
    assert.equal(
      db.docData(EXECUTIONS, "exec_1")!.analytics_generation_state,
      "generated"
    );
  });

  test("geração concorrente com lock fresco é rejeitada", async () => {
    await db.collection(EXECUTIONS).doc("exec_1").update({
      analytics_generation_state: "generating",
      analytics_generation_lock_id: "req_other",
      analytics_generation_lock_at: Timestamp.now(),
      analytics_revision: 1,
    });

    await assert.rejects(
      generateOccurrencesForExecution(deps, buildParams("req_2")),
      GenerationInProgressError
    );
  });

  test("lock obsoleto (>10min) é assumido e a revisão incrementa", async () => {
    await db.collection(EXECUTIONS).doc("exec_1").update({
      analytics_generation_state: "generating",
      analytics_generation_lock_id: "req_dead",
      analytics_generation_lock_at: Timestamp.fromMillis(
        Date.now() - 11 * 60 * 1000
      ),
      analytics_revision: 3,
    });

    const report = await generateOccurrencesForExecution(deps, buildParams("req_new"));

    assert.equal(report.analytics_revision, 4);
    assert.equal(
      db.docData(EXECUTIONS, "exec_1")!.analytics_generation_state,
      "generated"
    );
  });
});

describe("reopen, novo complete e cancel (28.3)", () => {
  test("reopen: superseded preserva resolution_status congelado, nada é apagado", async () => {
    await generateOccurrencesForExecution(deps, buildParams("req_1"));
    const superseded = await supersedeOccurrencesForExecution(deps, "ws1", "exec_1");

    assert.equal(superseded, 1);
    const [occurrence] = db.allDocs(ANALYTICS_COLLECTIONS.occurrences);
    assert.equal(occurrence.record_status, "superseded");
    assert.equal(occurrence.is_current, false);
    // congelado: NÃO vira "cancelled"
    assert.equal(occurrence.resolution_status, "open");
    assert.equal(occurrence.record_status_reason, "execution_reopened");
  });

  test("novo complete pós-reopen: revisão incrementa, registro antigo não bloqueia o novo", async () => {
    await generateOccurrencesForExecution(deps, buildParams("req_1"));
    await supersedeOccurrencesForExecution(deps, "ws1", "exec_1");
    const report = await generateOccurrencesForExecution(deps, buildParams("req_2"));

    assert.equal(report.analytics_revision, 2);

    const occurrences = db.allDocs(ANALYTICS_COLLECTIONS.occurrences);
    assert.equal(occurrences.length, 2);

    const current = occurrences.filter((doc) => doc.is_current === true);
    const old = occurrences.filter((doc) => doc.is_current === false);
    assert.equal(current.length, 1);
    assert.equal(current[0].analytics_revision, 2);
    assert.equal(old.length, 1);
    assert.equal(old[0].analytics_revision, 1);
    assert.equal(
      current[0].occurrence_identity_key,
      old[0].occurrence_identity_key
    );
    assert.notEqual(current[0].dedupe_key, old[0].dedupe_key);
  });

  test("cancel: registro sai dos indicadores com resolution_status cancelled", async () => {
    await generateOccurrencesForExecution(deps, buildParams("req_1"));
    const cancelled = await cancelOccurrencesForExecution(deps, "ws1", "exec_1");

    assert.equal(cancelled, 1);
    const [occurrence] = db.allDocs(ANALYTICS_COLLECTIONS.occurrences);
    assert.equal(occurrence.record_status, "cancelled");
    assert.equal(occurrence.is_current, false);
    assert.equal(occurrence.resolution_status, "cancelled");
    assert.equal(occurrence.resolution_source, "execution_cancelled");
  });

  test("invariante: is_current === (record_status === 'valid') em todos os caminhos", async () => {
    await generateOccurrencesForExecution(deps, buildParams("req_1"));
    await supersedeOccurrencesForExecution(deps, "ws1", "exec_1");
    await generateOccurrencesForExecution(deps, buildParams("req_2"));
    await cancelOccurrencesForExecution(deps, "ws1", "exec_1");

    for (const doc of db.allDocs(ANALYTICS_COLLECTIONS.occurrences)) {
      assert.equal(doc.is_current, doc.record_status === "valid");
    }
  });
});
