import assert from "node:assert/strict";
import { test } from "node:test";
import { serverModuleLoader } from "../helpers/load-server-module";

test("receipt audit discovery queries immutable actor/workspace and excludes other parents and workspaces", async () => {
  const filters: unknown[][] = [];
  const root = { id: "bankPaymentRequests", parent: null };
  const row = (id: string, workspaceId: string, parentCollection = "bankPaymentRequests") => {
    const parent = { id: `request-${id}`, path: `${parentCollection}/request-${id}`, parent: parentCollection === root.id ? root : { id: parentCollection, parent: null }, get: async () => ({ data: () => ({ workspaceId }) }) };
    const data: Record<string, unknown> = { actorId: "operator-1", workspaceId: "coala", type: "DOCUMENT_RECEIPT_PAYMENT_PREPARED" };
    return { id, ref: { id, path: `${parent.path}/events/${id}`, parent: { id: "events", parent } }, data: () => data, get: (field: string) => data[field] };
  };
  const rows = [row("own", "coala"), row("foreign-workspace", "other"), row("foreign-parent", "coala", "unrelated")];
  const query = {
    where(field: string, operator: string, value: unknown) { filters.push([field, operator, value]); return this; },
    orderBy() { return this; }, limit() { return this; },
    async get() { return { size: rows.length, docs: rows }; },
  };
  const userDb = { collection: () => ({ doc: (id: string) => ({ get: async () => ({ id, exists: true, data: () => ({ workspaceId: "coala" }) }) }) }) };
  const load = serverModuleLoader({
    "firebase-admin/firestore": { FieldPath: { documentId: () => "__name__" } },
    "@/lib/firebase-admin": { dbAdmin: userDb },
    "@/lib/firebase-rh-admin": { hrDbAdmin: {} },
    "@/lib/firebase-financial-admin": { financialDbAdmin: {} },
    "@/lib/firebase-rep-p-admin": { repPDbAdmin: {} },
    "@/lib/unit-access": { canAccessUnit: () => true, canAccessUserByUnit: () => true, resolveUnitAccess: () => ({ allUnits: true }) },
    "@/lib/observability/app-error": { AppError: Error },
    "./person-lookup.server": { firestorePersonLookup: {} },
    "./person-subject": { subjectKey: (ref: { namespace: string; id: string }) => `${ref.namespace}:${ref.id}`, resolveStrictPersonRefs: async (ref: unknown) => ({ refs: [ref], conflicts: [] }) },
    "./person-cursor.server": { readPersonCursor: () => { throw new Error("No cursor expected"); }, savePersonCursor: () => { throw new Error("No cursor expected"); } },
  });
  const { collectPersonSource } = load("src/features/privacy/person-inventory.server.ts") as { collectPersonSource: (input: unknown) => Promise<{ items: Array<{ id: string; role: string }>; source: { namespace: string }; status: string }> };
  const result = await collectPersonSource({ actor: { isDefaultAdmin: true, permissions: {}, userDoc: {}, workspace_id: "coala" }, ref: { namespace: "main.users", id: "operator-1" }, sourceId: "financial-receipt-preparation-actors", limit: 5, sourceDb: { collectionGroup(name: string) { assert.equal(name, "events"); return query; } } });
  assert.deepEqual(filters, [["actorId", "==", "operator-1"], ["workspaceId", "==", "coala"]]);
  assert.equal(result.source.namespace, "main.users");
  assert.deepEqual(result.items.map((item) => [item.id, item.role]), [["own", "actor"]]);
});
