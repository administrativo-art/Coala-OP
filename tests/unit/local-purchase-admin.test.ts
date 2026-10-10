import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  localPurchaseReversalBlock,
  localPurchaseStockShortfalls,
  reverseLocalPurchaseSchema,
} from "../../src/features/purchasing/local-purchase-admin";
import { defaultAdminPermissions, defaultGuestPermissions } from "../../src/types";

test("a local purchase cannot be reversed once settled by a sangria or paid", () => {
  const pending = { status: "pending", paymentState: "open" };
  assert.equal(localPurchaseReversalBlock({ purchaseStatus: "awaiting_cash_withdrawal", expense: pending }), null);
  assert.equal(localPurchaseReversalBlock({ purchaseStatus: "awaiting_company_payment", expense: null }), null);
  assert.equal(localPurchaseReversalBlock({ purchaseStatus: "cancelled", expense: { status: "cancelled" } }), null);
  assert.match(localPurchaseReversalBlock({ purchaseStatus: "reconciled", expense: pending })!, /fechamento de caixa/);
  assert.match(localPurchaseReversalBlock({ purchaseStatus: "awaiting_cash_withdrawal", expense: { ...pending, sourceSettlement: { sourceId: "x" } } })!, /fechamento de caixa/);
  for (const evidence of [{ status: "paid" }, { status: "partially_paid" }, { paidAt: "2026-10-09" }, { linkedBankTransactionId: "t" }, { paymentRequestId: "r" }, { paymentId: "p" }]) {
    assert.match(localPurchaseReversalBlock({ purchaseStatus: "awaiting_company_payment", expense: { ...pending, ...evidence } })!, /pagamento/);
  }
});

test("reversal refuses to take from stock more than is still there", () => {
  const lines = [{ productName: "Leite", quantity: 2 }, { productName: "Açúcar", quantity: 1 }];
  assert.deepEqual(localPurchaseStockShortfalls(lines, [2, 5]), []);
  assert.deepEqual(localPurchaseStockShortfalls(lines, [1, 0]), ["Leite (entrou 2, restam 1)", "Açúcar (entrou 1, restam 0)"]);
  assert.deepEqual(localPurchaseStockShortfalls(lines, [2]), ["Açúcar (entrou 1, restam 0)"]);
  assert.deepEqual(localPurchaseStockShortfalls([{ productName: "Leite", quantity: 0.3 }], [0.1 + 0.2]), []);
});

test("reversal demands a reason and rejects unknown fields", () => {
  assert.equal(reverseLocalPurchaseSchema.safeParse({ purchaseId: "local_purchase_coala_x", reason: "Nota lançada em duplicidade" }).success, true);
  assert.equal(reverseLocalPurchaseSchema.safeParse({ purchaseId: "local_purchase_coala_x", reason: "erro" }).success, false);
  assert.equal(reverseLocalPurchaseSchema.safeParse({ purchaseId: "a/b", reason: "Nota lançada em duplicidade" }).success, false);
  assert.equal(reverseLocalPurchaseSchema.safeParse({ purchaseId: "x", reason: "Nota lançada em duplicidade", skipStock: true }).success, false);
});

test("stock entry by the app is its own permission, off by default and enforced on the server", () => {
  assert.equal(defaultGuestPermissions.app.localPurchase.stockEntry, false);
  assert.equal(defaultAdminPermissions.app.localPurchase.stockEntry, true);
  assert.match(readFileSync("src/features/purchasing/local-purchase.server.ts", "utf8"), /permissions\.app\?\.localPurchase\?\.stockEntry !== true/);
  assert.match(readFileSync("src/app/api/purchasing/local-purchases/context/route.ts", "utf8"), /stockEntry === true \? listLocalPurchaseProducts\(\) : \[\]/);
  assert.match(readFileSync("src/features/financial/inbox/mobile-upload.server.ts", "utf8"), /stockEntry === true/);
});

test("reversal checks permission, unit scope and reverses stock before the financial records", () => {
  const server = readFileSync("src/features/purchasing/local-purchase-admin.server.ts", "utf8");
  assert.match(server, /canRevertPurchaseStage\(actor\.permissions\)/);
  assert.match(server, /canAccessUnit\(actor\.userDoc, String\(snapshot\.get\("unitId"\)\)/);
  assert.ok(server.indexOf("await reverseStockEntry(") < server.indexOf('status: "cancelled", statusBeforeCancellation'));
  assert.match(server, /type: "ENTRADA_ESTORNO"/);
  assert.match(server, /if \(!entry\.exists \|\| entry\.get\("reversedAt"\)\) return;/);
  const route = readFileSync("src/app/api/purchasing/local-purchases/reverse/route.ts", "utf8");
  assert.match(route, /action: "purchasing\.revertPurchaseStage"/);
  assert.match(route, /export const POST = secureRoute/);
});
