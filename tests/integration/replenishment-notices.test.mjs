import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin: db } = await import('../../src/lib/firebase-admin.ts');
const { defaultGuestPermissions } = await import('../../src/types/index.ts');
const { ignorePendingPurchaseNotice } = await import('../../src/lib/pending-purchase-notice-store.ts');

test('ignore is scoped, audited and idempotent without modifying order, receipt quantities or stock', async t => {
  const receipt = db.collection('purchase_receipts').doc('notice-contract-receipt');
  const item = receipt.collection('items').doc('notice-contract-item');
  const order = db.collection('purchase_orders').doc('notice-contract-order');
  const lot = db.collection('lots').doc('notice-contract-lot');
  const user = { isDefaultAdmin: false, permissions: structuredClone(defaultGuestPermissions),
    userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['notice-unit-a'] },
    decoded: { uid: 'notice-operator' }, workspace_id: 'coala' };
  user.permissions.purchasing.receivePurchase = true;
  const input = { purchaseReceiptId: receipt.id, purchaseReceiptItemId: item.id,
    destinationKioskId: 'notice-unit-a', reason: 'Fornecedor não entregará o saldo' };
  await Promise.all([
    receipt.set({ workspaceId: 'coala', destinationKioskId: 'notice-unit-a', status: 'partially_stocked', purchaseOrderId: order.id }),
    item.set({ status: 'partial', quantityOrdered: 10, quantityReceived: 4, quantityPendingStockEntry: 4 }),
    order.set({ status: 'confirmed', totalExpected: 123, expenseId: 'unchanged-expense' }),
    lot.set({ quantity: 14, reservedQuantity: 2 }),
  ]);
  t.after(async () => { await Promise.all([item.delete(), receipt.delete(), order.delete(), lot.delete()]); });
  const beforeOrder = (await order.get()).data(), beforeReceipt = (await receipt.get()).data();
  await assert.rejects(ignorePendingPurchaseNotice(db, user, { ...input, destinationKioskId: 'notice-unit-b' }));
  assert.equal((await item.get()).get('noticeIgnoredAt'), undefined);
  assert.equal(await ignorePendingPurchaseNotice(db, user, input), 'ignored');
  assert.equal(await ignorePendingPurchaseNotice(db, user, input), 'already_ignored');
  const saved = (await item.get()).data();
  assert.equal(saved.noticeIgnoredBy, user.decoded.uid);
  assert.equal(saved.noticeIgnoreReason, input.reason);
  assert.equal(saved.quantityOrdered, 10);
  assert.equal(saved.quantityReceived, 4);
  assert.equal(saved.quantityPendingStockEntry, 4);
  assert.equal(saved.status, 'partial');
  assert.deepEqual((await receipt.get()).data(), beforeReceipt);
  assert.deepEqual((await order.get()).data(), beforeOrder);
  assert.deepEqual((await lot.get()).data(), { quantity: 14, reservedQuantity: 2 });
});
