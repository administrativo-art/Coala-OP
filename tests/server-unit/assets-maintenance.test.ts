import assert from "node:assert/strict";
import test from "node:test";

import type { ServerUserContext } from "../../src/lib/auth-server";
import { completeMaintenanceOccurrence, createManualMaintenance } from "../../src/features/assets/maintenance.server";

type RecordData = Record<string, unknown>;
type Ref = { key: string };
type Transaction = {
  get(ref: Ref): Promise<{ exists: boolean; data(): RecordData | undefined; get(field: string): unknown }>;
  create(ref: Ref, record: RecordData): void;
  update(ref: Ref, patch: RecordData): void;
};

function memoryFirestore(initial: Record<string, RecordData>) {
  const records = new Map(Object.entries(initial));
  let chain = Promise.resolve();
  const db = {
    collection: (collection: string) => ({ doc: (id: string): Ref => ({ key: `${collection}/${id}` }) }),
    runTransaction<Result>(run: (tx: Transaction) => Promise<Result>) {
      const transaction = chain.then(async () => {
        const pending = new Map<string, RecordData>();
        const result = await run({
          async get(ref) {
            const value = records.get(ref.key);
            return { exists: Boolean(value), data: () => value, get: (field) => value?.[field] };
          },
          create(ref, record) {
            assert.equal(records.has(ref.key), false);
            pending.set(ref.key, record);
          },
          update(ref, patch) {
            assert.equal(records.has(ref.key), true);
            pending.set(ref.key, { ...records.get(ref.key), ...patch });
          },
        });
        for (const [key, data] of pending) records.set(key, data);
        return result;
      });
      chain = transaction.then(() => {}, () => {});
      return transaction;
    },
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, records };
}

const actor = { workspace_id: "coala", userDoc: { id: "operadora-1", username: "Operadora" } } as ServerUserContext;
const manual = {
  idempotencyKey: "mesma-acao",
  description: "Troca de rolamento",
  assignee: { type: "user", id: "tecnico-1", nameSnapshot: "Nome informado pelo cliente" },
};

test("registro direto grava só a ocorrência fechada e é idempotente sob requisições concorrentes", async () => {
  const { db, records } = memoryFirestore({ "assets/bem": { workspaceId: "coala", code: "PAT-1", name: "Motor" } });
  let resolutions = 0;
  const deps = {
    db,
    async resolveAssignee() {
      resolutions += 1;
      return { type: "user" as const, id: "tecnico-1", nameSnapshot: "Nome do cadastro" };
    },
    async provision() { assert.fail("registro concluído não provisiona artefatos"); },
  };
  const input = { ...manual, mode: "completed", performedOn: "2026-01-10", components: ["Rolamento"] };
  const [first, replay] = await Promise.all([
    createManualMaintenance(actor, "bem", input, deps),
    createManualMaintenance(actor, "bem", input, deps),
  ]);
  assert.equal(first.reused, false);
  assert.deepEqual(replay, { id: first.id, reused: true });
  assert.equal(resolutions, 1);
  assert.equal(records.size, 2);
  const occurrence = records.get(`assetMaintenanceOccurrences/${first.id}`)!;
  assert.equal(occurrence.status, "completed");
  assert.equal(occurrence.performedOn, input.performedOn);
  assert.equal(occurrence.completedAt, occurrence.createdAt);
  assert.deepEqual(occurrence.assignee, { type: "user", id: "tecnico-1", nameSnapshot: "Nome do cadastro", namespace: "main.users" });
  assert.deepEqual(occurrence.createdBy, { userId: "operadora-1", nameSnapshot: "Operadora", namespace: "main.users" });
  assert.deepEqual(occurrence.completedBy, occurrence.createdBy);
  assert.deepEqual(occurrence.components, ["Rolamento"]);
  for (const field of ["dueDate", "priority", "taskId", "orderDocumentId", "provisioningStatus", "nextProvisionAttemptAt"]) {
    assert.equal(Object.hasOwn(occurrence, field), false);
  }
  await assert.rejects(createManualMaintenance(actor, "bem", { ...manual, dueDate: "2026-01-10" }, deps), { code: "ASSET_MAINTENANCE_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(createManualMaintenance(actor, "bem", { ...input, components: ["Motor"] }, deps), { code: "ASSET_MAINTENANCE_IDEMPOTENCY_CONFLICT" });
  assert.equal(records.size, 2);
});

test("chamada legada agenda com uma única execução de provisionamento", async () => {
  const { db, records } = memoryFirestore({ "assets/bem": { workspaceId: "coala", code: "PAT-1", name: "Motor" } });
  let provisions = 0;
  const deps = {
    db,
    async resolveAssignee() { return { type: "user" as const, id: "tecnico-1", nameSnapshot: "Técnico" }; },
    async provision() { provisions += 1; return true; },
  };
  const input = { ...manual, dueDate: "2026-01-10" };
  const [first, replay] = await Promise.all([
    createManualMaintenance(actor, "bem", input, deps),
    createManualMaintenance(actor, "bem", { ...input, mode: "scheduled" }, deps),
  ]);
  assert.equal(provisions, 1);
  assert.deepEqual(replay, { id: first.id, reused: true });
  const occurrence = records.get(`assetMaintenanceOccurrences/${first.id}`)!;
  assert.equal(occurrence.status, "open");
  assert.equal(occurrence.provisioningStatus, "pending");
  assert.equal(occurrence.dueDate, input.dueDate);
});

test("conclusão rejeita versão concorrente e estado encerrado, e usa a data civil na cadência", async () => {
  const { db, records } = memoryFirestore({
    "assetMaintenanceOccurrences/aberta": { workspaceId: "coala", assetId: "bem", status: "scheduled", version: 2, planId: "p1" },
    "assetMaintenanceOccurrences/cancelada": { workspaceId: "coala", assetId: "bem", status: "cancelled", version: 2 },
    "assetMaintenancePlans/p1": { workspaceId: "coala", cadence: { unit: "months", interval: 1 }, leadDays: 7 },
  });
  const input = { expectedVersion: 2, performedOn: "2026-01-31", result: "Troca de rolamento" };
  const [first, concurrent] = await Promise.allSettled([
    completeMaintenanceOccurrence(actor, "aberta", input, db),
    completeMaintenanceOccurrence(actor, "aberta", input, db),
  ]);
  assert.deepEqual(first, { status: "fulfilled", value: { ok: true } });
  assert.equal(concurrent.status, "rejected");
  if (concurrent.status === "rejected") assert.equal(concurrent.reason.code, "ASSET_MAINTENANCE_VERSION_CONFLICT");
  const occurrence = records.get("assetMaintenanceOccurrences/aberta")!;
  assert.equal(occurrence.status, "completed");
  assert.equal(occurrence.version, 3);
  assert.equal(occurrence.performedOn, input.performedOn);
  assert.equal(occurrence.completedAt, occurrence.updatedAt);
  assert.equal(records.get("assetMaintenancePlans/p1")?.nextDueDate, "2026-02-28");
  assert.equal(records.get("assetMaintenancePlans/p1")?.materializeOn, "2026-02-21");
  await assert.rejects(completeMaintenanceOccurrence(actor, "aberta", { ...input, expectedVersion: 3 }, db), { code: "ASSET_MAINTENANCE_STATUS_CONFLICT" });
  await assert.rejects(completeMaintenanceOccurrence(actor, "cancelada", input, db), { code: "ASSET_MAINTENANCE_STATUS_CONFLICT" });
  assert.equal(records.get("assetMaintenanceOccurrences/cancelada")?.status, "cancelled");
});
