import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideOccurrenceEffect,
  decideValidationApproval,
  decideValidationRejection,
  resolveCompletionResult,
  ResolutionFlowError,
  type OccurrenceSyncView,
} from "../../../src/features/forms/analytics/task-sync-core";
import type { TaskView } from "../../../src/features/forms/analytics/task-model";

const OCCURRED_AT = new Date("2026-07-01T12:00:00Z");

function occurrence(
  overrides: Partial<OccurrenceSyncView> = {}
): OccurrenceSyncView {
  return {
    id: "occ_1",
    is_current: true,
    record_status: "valid",
    resolution_status: "open",
    resolution_behavior: "auto_resolve_on_task_completion",
    occurred_at: OCCURRED_AT,
    ...overrides,
  };
}

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: "task_1",
    workspace_id: "ws1",
    lifecycle_state: "open",
    version: 5,
    ...overrides,
  };
}

describe("sync idempotente por versão (28.5)", () => {
  test("versão antiga é no-op (replay de trigger não regride estado)", () => {
    const effect = decideOccurrenceEffect(
      occurrence({ last_task_version_synced: 5 }),
      task({ version: 5, lifecycle_state: "in_progress" })
    );
    assert.deepEqual(effect, { kind: "noop", reason: "stale_version" });
  });

  test("ocorrência superseded não é alterada por sync", () => {
    const effect = decideOccurrenceEffect(
      occurrence({ is_current: false, record_status: "superseded" }),
      task({ lifecycle_state: "in_progress" })
    );
    assert.deepEqual(effect, { kind: "noop", reason: "occurrence_not_current" });
  });

  test("resolução manual vence: trigger de tarefa não sobrescreve", () => {
    const effect = decideOccurrenceEffect(
      occurrence({
        resolution_status: "resolved",
        resolution_source: "manual_resolution",
      }),
      task({
        lifecycle_state: "completed",
        completion_result: "resolved",
        completed_at: new Date(),
      })
    );
    assert.deepEqual(effect, { kind: "noop", reason: "manual_resolution_wins" });
  });
});

describe("resolução automática (28.5)", () => {
  test("completed + resolved + auto_resolve → resolve com tempo calculado", () => {
    const completedAt = new Date("2026-07-01T14:30:00Z");
    const effect = decideOccurrenceEffect(
      occurrence(),
      task({
        lifecycle_state: "completed",
        completion_result: "resolved",
        completed_at: completedAt,
        completed_by: "user_9",
      })
    );
    assert.equal(effect.kind, "resolve");
    if (effect.kind === "resolve") {
      assert.equal(effect.resolution_source, "task_completion");
      assert.equal(effect.resolved_by, "user_9");
      assert.equal(effect.resolution_time_minutes, 150);
    }
  });

  test("completed + not_resolved NÃO resolve a ocorrência", () => {
    const effect = decideOccurrenceEffect(
      occurrence({ resolution_status: "in_progress" }),
      task({
        lifecycle_state: "completed",
        completion_result: "not_resolved",
        completed_at: new Date(),
      })
    );
    // volta para open (tarefa terminou sem resolver)
    assert.deepEqual(effect, { kind: "update_status", resolution_status: "open" });
  });

  test("completed + partially_resolved não resolve", () => {
    const effect = decideOccurrenceEffect(
      occurrence(),
      task({
        lifecycle_state: "completed",
        completion_result: "partially_resolved",
      })
    );
    assert.equal(effect.kind, "noop");
  });

  test("resolution_behavior none/manual não resolve por tarefa", () => {
    for (const behavior of ["none", "manual_resolution_only"] as const) {
      const effect = decideOccurrenceEffect(
        occurrence({ resolution_behavior: behavior }),
        task({
          lifecycle_state: "completed",
          completion_result: "resolved",
          completed_at: new Date(),
        })
      );
      assert.equal(effect.kind, "noop");
    }
  });
});

describe("validação obrigatória (28.5)", () => {
  test("completed + resolved + require_validation → pending_validation", () => {
    const effect = decideOccurrenceEffect(
      occurrence({
        resolution_behavior: "require_validation_after_task_completion",
      }),
      task({
        lifecycle_state: "completed",
        completion_result: "resolved",
        completed_at: new Date(),
      })
    );
    assert.deepEqual(effect, { kind: "pending_validation" });
  });

  test("aprovação resolve com resolution_source validation", () => {
    const approvedAt = new Date("2026-07-01T13:00:00Z");
    const patch = decideValidationApproval(
      occurrence({ resolution_status: "pending_validation" }),
      { approved_at: approvedAt, approved_by: "gestor_1" }
    );
    assert.equal(patch.resolution_status, "resolved");
    assert.equal(patch.resolution_source, "validation");
    assert.equal(patch.resolved_by, "gestor_1");
    assert.equal(patch.resolution_time_minutes, 60);
  });

  test("aprovação/rejeição só em pending_validation", () => {
    assert.throws(
      () =>
        decideValidationApproval(occurrence({ resolution_status: "open" }), {
          approved_at: new Date(),
          approved_by: "gestor_1",
        }),
      ResolutionFlowError
    );
    assert.throws(
      () => decideValidationRejection(occurrence({ resolution_status: "open" })),
      ResolutionFlowError
    );
  });

  test("rejeição reabre limpando campos de resolução", () => {
    const patch = decideValidationRejection(
      occurrence({ resolution_status: "pending_validation" })
    );
    assert.deepEqual(patch, {
      resolution_status: "open",
      clear_resolution_fields: true,
    });
  });
});

describe("tarefa cancelada e estados intermediários", () => {
  test("tarefa cancelada devolve ocorrência a open", () => {
    const effect = decideOccurrenceEffect(
      occurrence({ resolution_status: "in_progress" }),
      task({ lifecycle_state: "cancelled" })
    );
    assert.deepEqual(effect, { kind: "task_cancelled", resolution_status: "open" });
  });

  test("tarefa cancelada não mexe em ocorrência resolvida", () => {
    const effect = decideOccurrenceEffect(
      occurrence({ resolution_status: "resolved" }),
      task({ lifecycle_state: "cancelled" })
    );
    assert.equal(effect.kind, "noop");
  });

  test("in_progress/waiting/blocked propagam e marcam primeira ação", () => {
    for (const state of ["in_progress", "waiting", "blocked"] as const) {
      const effect = decideOccurrenceEffect(
        occurrence(),
        task({ lifecycle_state: state })
      );
      assert.equal(effect.kind, "update_status");
      if (effect.kind === "update_status") {
        assert.equal(effect.resolution_status, state);
        assert.ok(effect.set_first_action_at instanceof Date);
      }
    }
  });

  test("avaliação (not_required) nunca é tocada", () => {
    const effect = decideOccurrenceEffect(
      occurrence({ resolution_status: "not_required" }),
      task({ lifecycle_state: "in_progress" })
    );
    assert.deepEqual(effect, { kind: "noop", reason: "not_required" });
  });
});

describe("Concluir universal (28.5)", () => {
  test("completion_result obrigatório quando há ocorrência vinculada", () => {
    assert.throws(() => resolveCompletionResult(undefined, true), ResolutionFlowError);
  });

  test("default resolved quando não há ocorrência vinculada", () => {
    assert.equal(resolveCompletionResult(undefined, false), "resolved");
    assert.equal(resolveCompletionResult("not_resolved", true), "not_resolved");
  });
});
