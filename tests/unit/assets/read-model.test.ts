import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
