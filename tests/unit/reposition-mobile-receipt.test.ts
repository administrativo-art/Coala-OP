import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMobileReceipt, receiveMobileRepositionSchema, toMobileRepositionActivity } from "../../src/features/reposition/mobile-receipt";
import { defaultAdminPermissions, defaultGuestPermissions, type RepositionActivity } from "../../src/types";

const activity = {
  id: "act-1", status: "Aguardando recebimento", kioskOriginId: "cd", kioskOriginName: "CD", kioskDestinationId: "unit-x", kioskDestinationName: "Unidade X",
  createdAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z", requestedBy: { userId: "u", username: "u" },
  transportSignature: { signedBy: "Motorista", signedAt: "2026-10-09T12:00:00.000Z", dataUrl: "data:image/png;base64,AAAA" },
  items: [
    { baseProductId: "base-milk", productName: "Leite", quantityNeeded: 12, suggestedLots: [
      { lotId: "lot-1", productId: "p1", productName: "Leite (1L)", lotNumber: "A", quantityToMove: 8 },
      { lotId: "lot-2", productId: "p1", productName: "Leite (1L)", lotNumber: "B", quantityToMove: 4 },
    ] },
    { baseProductId: "base-sugar", productName: "Açúcar", quantityNeeded: 5, suggestedLots: [{ lotId: "lot-3", productId: "p2", productName: "", lotNumber: "C", quantityToMove: 5 }] },
  ],
} as unknown as RepositionActivity;
const row = (baseProductId: string, lotId: string, receivedQuantity: number, notes = "") => ({ baseProductId, lotId, receivedQuantity, notes });
const allAsSent = [row("base-milk", "lot-1", 8), row("base-milk", "lot-2", 4), row("base-sugar", "lot-3", 5)];

test("receipt equal to the dispatch is recorded without divergence, in the web shape", () => {
  const receipt = buildMobileReceipt(activity, allAsSent);
  assert.equal(receipt.ok, true);
  if (!receipt.ok) return;
  assert.equal(receipt.status, "Recebido sem divergência");
  assert.deepEqual(receipt.items[0]!.receivedLots!.map((lot) => [lot.lotId, lot.receivedQuantity]), [["lot-1", 8], ["lot-2", 4]]);
  assert.equal(receipt.items[0]!.suggestedLots.length, 2);
  assert.equal("receiptNotes" in receipt.items[1]!.receivedLots![0]!, false);
});

test("a different quantity needs an explanation and marks the receipt as divergent", () => {
  assert.equal(buildMobileReceipt(activity, [row("base-milk", "lot-1", 6), ...allAsSent.slice(1)]).ok, false);
  const receipt = buildMobileReceipt(activity, [row("base-milk", "lot-1", 6, "duas caixas amassadas"), ...allAsSent.slice(1)]);
  assert.equal(receipt.ok && receipt.status, "Recebido com divergência");
  assert.equal(receipt.ok && receipt.items[0]!.receivedLots![0]!.receiptNotes, "duas caixas amassadas");
  const nothing = buildMobileReceipt(activity, [row("base-milk", "lot-1", 0, "não veio"), ...allAsSent.slice(1)]);
  assert.equal(nothing.ok && nothing.hasDivergence, true);
});

test("the receipt must cover exactly the dispatched lots", () => {
  assert.equal(buildMobileReceipt(activity, allAsSent.slice(0, 2)).ok, false);
  assert.equal(buildMobileReceipt(activity, [...allAsSent, row("base-x", "lot-9", 1)]).ok, false);
  assert.equal(buildMobileReceipt(activity, [allAsSent[0]!, allAsSent[0]!, allAsSent[2]!]).ok, false);
  assert.equal(buildMobileReceipt(activity, [row("base-sugar", "lot-1", 8), allAsSent[1]!, allAsSent[2]!]).ok, false);
});

test("the app payload shows what was sent and never the transport signature image", () => {
  const view = toMobileRepositionActivity(activity);
  assert.equal(view.destinationName, "Unidade X");
  assert.equal(view.dispatchedBy, "Motorista");
  assert.deepEqual(view.rows.map((entry) => [entry.productName, entry.lotNumber, entry.sentQuantity]), [["Leite (1L)", "A", 8], ["Leite (1L)", "B", 4], ["Açúcar", "C", 5]]);
  assert.equal(JSON.stringify(view).includes("base64"), false);
  // The product id is only used on the server to look up the photo and is stripped before the response.
  assert.match(readFileSync("src/features/reposition/mobile-receipt.server.ts", "utf8"), /rows\.map\(\(\{ productId, \.\.\.row \}\) => \(\{ \.\.\.row, imageUrl:/);
});

test("receipt schema is strict and bounded", () => {
  assert.equal(receiveMobileRepositionSchema.safeParse({ activityId: "act-1", rows: allAsSent }).success, true);
  assert.equal(receiveMobileRepositionSchema.safeParse({ activityId: "act-1", rows: [] }).success, false);
  assert.equal(receiveMobileRepositionSchema.safeParse({ activityId: "act-1", rows: [row("b", "l", -1)] }).success, false);
  assert.equal(receiveMobileRepositionSchema.safeParse({ activityId: "act-1", rows: allAsSent, status: "Concluído" }).success, false);
  assert.equal(receiveMobileRepositionSchema.safeParse({ activityId: "act-1", rows: [{ ...allAsSent[0], quantityToMove: 99 }] }).success, false);
});

test("only the destination unit receives, with the app permission, and only while in transit", () => {
  assert.equal(defaultGuestPermissions.app.reposition.receive, false);
  assert.equal(defaultAdminPermissions.app.reposition.receive, true);
  const server = readFileSync("src/features/reposition/mobile-receipt.server.ts", "utf8");
  assert.match(server, /permissions\.app\?\.reposition\?\.receive !== true/);
  assert.match(server, /\.filter\(\(activity\) => canReceiveAt\(actor, activity\.kioskDestinationId\)\)/);
  assert.match(server, /!canReceiveAt\(actor, activity\.kioskDestinationId\)\) failure\("NOT_FOUND"/);
  assert.match(server, /if \(activity\.status !== AWAITING_RECEIPT\)/);
  assert.match(server, /where\("status", "==", AWAITING_RECEIPT\)/);
  // Receiving never touches lots: stock moves only when the reposition is finalized in the web system.
  assert.doesNotMatch(server, /collection\("lots"\)|movementHistory/);
  for (const route of ["route.ts", "receive/route.ts"]) {
    const source = readFileSync(`src/app/api/stock/mobile-reposition/${route}`, "utf8");
    assert.match(source, /action: "app\.reposition\.receive"/);
    assert.match(source, /secureRoute\(\{ contract, enforcer \}/);
  }
});
