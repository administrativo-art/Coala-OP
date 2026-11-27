import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isGroupedMaintenanceChild, linkedMaintenanceId, projectHistoryMaintenance } from "../../../src/features/assets/history-maintenance";
import { mergeHistoryPages } from "../../../src/features/assets/history-pagination";
import { purchaseAcquisitionRelationError } from "../../../src/features/assets/purchase-acquisition";

test("limites, cursor composto e CSV do histórico são seguros", () => {
  const source = readFileSync("src/features/assets/read-model.server.ts", "utf8");
  assert.match(source, /Math\.min\(Math\.max\(Number\(value\) \|\| fallback, 1\), 100\)/);
  assert.match(source, /orderBy\(FieldPath\.documentId\(\), "desc"\)/);
  assert.match(source, /replace\(\/"\/g, '\"\"'\)/);
  assert.match(source, /replace\(\/\[\\r\\n\]\+\/g, " "\)/);
});

test("contratos de leitura patrimonial usam secureRoute e limites", () => {
  for (const path of [
    "src/app/api/assets/[assetId]/audits/list/route.ts",
    "src/app/api/assets/[assetId]/maintenance-plans/list/route.ts",
    "src/app/api/assets/[assetId]/maintenance-occurrences/list/route.ts",
    "src/app/api/assets/[assetId]/maintenance-occurrences/[occurrenceId]/order/route.ts",
    "src/app/api/assets/[assetId]/history/route.ts",
    "src/app/api/users/[userId]/assets/route.ts",
    "src/app/api/assets/[assetId]/acquisition/route.ts",
  ]) assert.match(readFileSync(path, "utf8"), /secureRoute/);
  const profile = readFileSync("src/app/api/users/[userId]/assets/route.ts", "utf8");
  assert.match(profile, /limit\(101\)/);
  assert.doesNotMatch(profile, /serialNumber|imei|phone/);
  const acquisition = readFileSync("src/app/api/assets/[assetId]/acquisition/route.ts", "utf8");
  assert.match(acquisition, /readOnly: true/);
  assert.doesNotMatch(acquisition, /\.update\(|\.set\(/);
});

test("merge paginado avança somente as fontes emitidas", () => {
  const row = (source: string, id: string, at: string) => ({ source, id, at, type: source, description: id });
  const first = mergeHistoryPages([
    { source: "movement", rows: [row("movement", "m3", "2026-10-03"), row("movement", "m2", "2026-10-02")] },
    { source: "audit", rows: [row("audit", "a4", "2026-10-04"), row("audit", "a1", "2026-10-01")] },
  ], 2);
  assert.deepEqual(first.items.map((item) => item.id), ["a4", "m3"]);
  assert.deepEqual(first.sources, { audit: { at: "2026-10-04", id: "a4" }, movement: { at: "2026-10-03", id: "m3" } });
  assert.equal(first.hasMore, true);
  const second = mergeHistoryPages([
    { source: "movement", rows: [row("movement", "m2", "2026-10-02")] },
    { source: "audit", rows: [row("audit", "a1", "2026-10-01")] },
  ], 2, first.sources);
  assert.deepEqual(second.items.map((item) => item.id), ["m2", "a1"]);
  assert.equal(second.hasMore, false);
});

test("aquisição rejeita escopo e relações cruzadas", () => {
  const identity = { workspaceId: "coala", purchaseOrderId: "po", purchaseReceiptId: "pr", purchaseReceiptItemId: "ri" };
  const valid = { orderExists: true, orderWorkspaceId: "coala", receiptExists: true, receiptWorkspaceId: "coala", receiptPurchaseOrderId: "po", receiptItemExists: true, receiptItemPurchaseReceiptId: "pr", receiptItemPurchaseOrderItemId: "oi", orderItemExists: true, orderItemId: "oi" };
  assert.equal(purchaseAcquisitionRelationError(identity, valid), null);
  assert.equal(purchaseAcquisitionRelationError(identity, { ...valid, receiptWorkspaceId: "outro" }), "PURCHASE_ACQUISITION_SCOPE");
  assert.equal(purchaseAcquisitionRelationError(identity, { ...valid, receiptPurchaseOrderId: "outro" }), "PURCHASE_ACQUISITION_RELATION");
  assert.equal(purchaseAcquisitionRelationError(identity, { ...valid, orderItemExists: false }), "PURCHASE_ACQUISITION_NOT_FOUND");
});

test("merge consome filhos ocultos e usa cursor para alcançar a ocorrência em outra página", () => {
  const newest = { source: "document", id: "ordem", at: "2026-11-26", type: "document", description: "", hidden: true };
  const older = { source: "movement", id: "movimento", at: "2026-11-25", type: "MANUTENCAO_ORDEM", description: "", hidden: true };
  const root = { source: "maintenance", id: "ocorrencia", at: "2026-11-22", type: "manual", description: "Troca" };
  const independent = { source: "audit", id: "auditoria", at: "2026-11-24", type: "audit", description: "Troca" };
  const first = mergeHistoryPages([{ source: "document", rows: [newest], hasMore: true }, { source: "maintenance", rows: [root] }], 1);
  assert.deepEqual(first.items, []);
  assert.deepEqual(first.sources, { document: { at: newest.at, id: newest.id } });
  assert.equal(first.hasMore, true);
  const second = mergeHistoryPages([
    { source: "movement", rows: [older] }, { source: "audit", rows: [independent] }, { source: "maintenance", rows: [root] },
  ], 1, first.sources);
  assert.deepEqual(second.items, [independent]);
  assert.deepEqual(second.sources.movement, { at: older.at, id: older.id });
  assert.equal(second.sources.maintenance, undefined);
  assert.equal(second.hasMore, true);
  const third = mergeHistoryPages([{ source: "maintenance", rows: [root] }], 1, second.sources);
  assert.deepEqual(third.items, [root]);
  assert.deepEqual(third.sources.maintenance, { at: root.at, id: root.id });
  assert.equal(third.hasMore, false);
});

test("consolidação exige vínculos exatos e mantém auditorias, órfãos e registros legados independentes", () => {
  const scope = { workspaceId: "coala", assetId: "bem" };
  const rootId = "ocorrencia";
  const documentId = "ordem";
  const root = {
    ...scope, createdAt: "2026-11-24", description: "Troca", orderDocumentId: documentId,
    performedOn: "2026-11-22", status: "completed", assignee: { nameSnapshot: "Oficina" },
    createdBy: { nameSnapshot: "Agendador", id: "agendador-id" },
    completedBy: { nameSnapshot: "Operadora", userId: "operadora-id" }, components: ["Rolamento"],
  };
  const order = {
    workspaceId: "coala", sourceAssetId: "bem", sourceMaintenanceOccurrenceId: rootId,
    protocol: "CS-MNT", pdfStoragePath: "privado/ordem.pdf", description: "Troca",
  };
  const movement = { ...scope, type: "MANUTENCAO_ORDEM", source: { type: "maintenance", id: rootId }, description: "Troca" };
  assert.equal(linkedMaintenanceId("movement", movement), rootId);
  assert.equal(isGroupedMaintenanceChild(scope, "movement", "movimento", movement, root), true);
  assert.equal(isGroupedMaintenanceChild(scope, "document", documentId, order, root), true);
  assert.equal(isGroupedMaintenanceChild(scope, "document", "outro-documento", order, root), false);
  assert.equal(isGroupedMaintenanceChild(scope, "document", documentId, { ...order, sourceAssetId: "outro" }, root), false);
  assert.equal(isGroupedMaintenanceChild(scope, "movement", "edicao", { ...movement, type: "EDICAO" }, root), false);
  assert.equal(isGroupedMaintenanceChild(scope, "audit", "auditoria", movement, root), false);
  assert.equal(isGroupedMaintenanceChild(scope, "movement", "movimento", { ...movement, source: null }, root), false);
  assert.equal(isGroupedMaintenanceChild(scope, "movement", "movimento", movement, undefined), false);
  assert.equal(isGroupedMaintenanceChild(scope, "movement", "movimento", movement, { ...root, workspaceId: "outro" }), false);
  const projected = projectHistoryMaintenance(scope, rootId, root, order);
  assert.equal(projected.performedOn, "2026-11-22");
  assert.equal(projected.registeredByLabel, "Agendador");
  assert.equal(projected.completedByLabel, "Operadora");
  const legacyProjection = projectHistoryMaintenance(scope, rootId, { ...root, createdBy: undefined }, order);
  assert.equal(legacyProjection.registeredByLabel, null);
  assert.equal(legacyProjection.completedByLabel, "Operadora");
  assert.deepEqual(projected.components, ["Rolamento"]);
  assert.deepEqual(projected.order, { documentId, protocol: "CS-MNT", href: "/api/assets/bem/maintenance-occurrences/ocorrencia/order" });
  assert.equal(projectHistoryMaintenance(scope, "occurrence-diferente", root, order).order, null);
});
