import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  cancelOccurrenceManually,
  ensureTasksForOccurrences,
  OccurrenceActionError,
  resolveOccurrenceManually,
} from "../../../src/features/forms/analytics/task-integration";
import {
  ANALYTICS_COLLECTIONS,
} from "../../../src/features/forms/analytics/types";
import { OCCURRENCE_TASK_LINKS_COLLECTION } from "../../../src/features/forms/analytics/task-model";
import { FakeFirestore } from "./fake-firestore";

const OCC = ANALYTICS_COLLECTIONS.occurrences;

function seedOccurrence(
  db: FakeFirestore,
  id: string,
  overrides: Record<string, unknown> = {}
) {
  db.seed(OCC, id, {
    workspace_id: "ws1",
    execution_id: "exec_1",
    record_type: "occurrence",
    is_current: true,
    record_status: "valid",
    counts_as_occurrence: true,
    resolution_status: "open",
    resolution_behavior: "auto_resolve_on_task_completion",
    has_active_task: false,
    create_task: true,
    occurred_at: Timestamp.fromDate(new Date("2026-07-01T12:00:00Z")),
    item_title_snapshot: "Porta 09 funcionando?",
    target_name_snapshot: "Porta 09",
    domain_name_snapshot: "Manutenção",
    result_name_snapshot: "Manutenção necessária",
    ...overrides,
  });
}

let db: FakeFirestore;
const deps = () => ({
  db: db as unknown as Firestore,
  tasksCollection: "tasks",
});

beforeEach(() => {
  db = new FakeFirestore();
});

describe("ensureTasksForOccurrences", () => {
  test("cria tarefa + vínculo para ocorrência com create_task", async () => {
    seedOccurrence(db, "occ_1");
    const created: string[] = [];

    const report = await ensureTasksForOccurrences(deps(), {
      workspaceId: "ws1",
      executionId: "exec_1",
      createdBy: "user_1",
      createTask: async (seed) => {
        created.push(seed.occurrence_id);
        db.seed("tasks", "task_1", {
          workspace_id: "ws1",
          lifecycle_state: "open",
          version: 0,
        });
        return { id: "task_1" };
      },
    });

    assert.equal(report.tasks_linked, 1);
    assert.deepEqual(created, ["occ_1"]);

    const links = db.allDocs(OCCURRENCE_TASK_LINKS_COLLECTION);
    assert.equal(links.length, 1);
    assert.equal(links[0].task_id, "task_1");
    assert.equal(links[0].link_type, "primary");
    assert.equal(links[0].is_active, true);

    const occ = db.docData(OCC, "occ_1")!;
    assert.equal(occ.has_active_task, true);
    assert.equal(occ.current_primary_task_id, "task_1");
  });

  test("não cria tarefa para avaliação nem para ocorrência já resolvida", async () => {
    seedOccurrence(db, "occ_eval", {
      record_type: "evaluation",
      counts_as_occurrence: false,
      resolution_status: "not_required",
    });
    seedOccurrence(db, "occ_done", { resolution_status: "resolved" });

    let calls = 0;
    const report = await ensureTasksForOccurrences(deps(), {
      workspaceId: "ws1",
      executionId: "exec_1",
      createdBy: "user_1",
      createTask: async () => {
        calls += 1;
        return { id: "t" };
      },
    });

    assert.equal(calls, 0);
    assert.equal(report.tasks_linked, 0);
  });

  test("createTask retornando null é contado como skipped (sem regra de tarefa)", async () => {
    seedOccurrence(db, "occ_1");
    const report = await ensureTasksForOccurrences(deps(), {
      workspaceId: "ws1",
      executionId: "exec_1",
      createdBy: "user_1",
      createTask: async () => null,
    });
    assert.equal(report.tasks_linked, 0);
    assert.equal(report.skipped, 1);
    assert.equal(db.allDocs(OCCURRENCE_TASK_LINKS_COLLECTION).length, 0);
  });

  test("não duplica vínculo quando já existe link ativo (retry)", async () => {
    seedOccurrence(db, "occ_1", { has_active_task: true });
    db.seed(OCCURRENCE_TASK_LINKS_COLLECTION, "link_1", {
      workspace_id: "ws1",
      occurrence_id: "occ_1",
      task_id: "task_1",
      is_active: true,
      link_status: "active",
    });

    let calls = 0;
    const report = await ensureTasksForOccurrences(deps(), {
      workspaceId: "ws1",
      executionId: "exec_1",
      createdBy: "user_1",
      createTask: async () => {
        calls += 1;
        return { id: "task_new" };
      },
    });

    assert.equal(calls, 0);
    assert.equal(report.tasks_linked, 0);
    assert.equal(report.skipped, 1);
    assert.equal(db.allDocs(OCCURRENCE_TASK_LINKS_COLLECTION).length, 1);
  });
});

describe("resolução e cancelamento manual", () => {
  test("resolveOccurrenceManually marca resolved com fonte manual e tempo", async () => {
    seedOccurrence(db, "occ_1");
    await resolveOccurrenceManually(deps(), {
      occurrenceId: "occ_1",
      resolvedBy: "gestor_1",
      note: "resolvido no local",
    });

    const occ = db.docData(OCC, "occ_1")!;
    assert.equal(occ.resolution_status, "resolved");
    assert.equal(occ.resolution_source, "manual_resolution");
    assert.equal(occ.resolved_by, "gestor_1");
    assert.equal(typeof occ.resolution_time_minutes, "number");
    assert.equal(occ.resolution_note, "resolvido no local");
  });

  test("resolveOccurrenceManually rejeita ocorrência já resolvida", async () => {
    seedOccurrence(db, "occ_1", { resolution_status: "resolved" });
    await assert.rejects(
      resolveOccurrenceManually(deps(), {
        occurrenceId: "occ_1",
        resolvedBy: "gestor_1",
      }),
      OccurrenceActionError
    );
  });

  test("resolveOccurrenceManually rejeita registro superseded", async () => {
    seedOccurrence(db, "occ_1", {
      is_current: false,
      record_status: "superseded",
    });
    await assert.rejects(
      resolveOccurrenceManually(deps(), {
        occurrenceId: "occ_1",
        resolvedBy: "gestor_1",
      }),
      OccurrenceActionError
    );
  });

  test("cancelOccurrenceManually cancela e desativa vínculos ativos", async () => {
    seedOccurrence(db, "occ_1", { has_active_task: true });
    db.seed(OCCURRENCE_TASK_LINKS_COLLECTION, "link_1", {
      workspace_id: "ws1",
      occurrence_id: "occ_1",
      task_id: "task_1",
      is_active: true,
      link_status: "active",
    });

    await cancelOccurrenceManually(deps(), {
      occurrenceId: "occ_1",
      cancelledBy: "gestor_1",
      reason: "duplicada",
    });

    const occ = db.docData(OCC, "occ_1")!;
    assert.equal(occ.resolution_status, "cancelled");
    assert.equal(occ.has_active_task, false);

    const link = db.docData(OCCURRENCE_TASK_LINKS_COLLECTION, "link_1")!;
    assert.equal(link.is_active, false);
    assert.equal(link.link_status, "cancelled");
    assert.equal(link.deactivation_reason, "occurrence_cancelled");
  });
});
