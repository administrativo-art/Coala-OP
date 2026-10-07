import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { assertNoticeAccess, pendingNoticeQuantities, ignoreNoticeSchema } from '../../src/lib/pending-purchase-notice-policy';
import { defaultGuestPermissions } from '../../src/types';
import type { ServerUserContext } from '../../src/lib/auth-server';
import { withApiErrorHandling } from '../../src/lib/observability/api-error';

function actor(): ServerUserContext {
  return { permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false,
    userDoc: { id: 'reader', unitAccessScope: 'selected', unitAccessUnitIds: ['unit-a'] } as ServerUserContext['userDoc'],
    decoded: { uid: 'reader' } as ServerUserContext['decoded'], profileId: null, workspace_id: 'coala' };
}

test('notice permission never grants access to another unit or write to a stock viewer', () => {
  const user = actor();
  assert.throws(() => assertNoticeAccess(user, 'unit-a', 'read'));
  user.permissions.stock.view = true;
  assert.doesNotThrow(() => assertNoticeAccess(user, 'unit-a', 'read'));
  assert.throws(() => assertNoticeAccess(user, 'unit-b', 'read'));
  assert.throws(() => assertNoticeAccess(user, 'unit-a', 'ignore'));
  user.permissions.purchasing.receivePurchase = true;
  assert.doesNotThrow(() => assertNoticeAccess(user, 'unit-a', 'ignore'));
  assert.throws(() => assertNoticeAccess(user, 'unit-b', 'ignore'));
});

test('receipt partial splits not delivered and awaiting stock without mutating data', () => {
  const item = Object.freeze({ quantityOrdered: 10, quantityReceived: 4, quantityPendingStockEntry: 4, status: 'partial' });
  assert.deepEqual(pendingNoticeQuantities(item), { quantityNotReceived: 6, quantityPendingStockEntry: 4 });
  assert.deepEqual(pendingNoticeQuantities({ ...item, quantityPendingStockEntry: 0 }),
    { quantityNotReceived: 6, quantityPendingStockEntry: 0 });
  assert.equal(item.quantityReceived, 4);
});

test('closed shortage is not in transit but received goods still await stock entry', () => {
  const item = { quantityOrdered: 10, quantityReceived: 4, quantityPendingStockEntry: 4 };
  assert.deepEqual(pendingNoticeQuantities({ ...item, divergenceResolutionAction: 'close_shortage' }),
    { quantityNotReceived: 0, quantityPendingStockEntry: 4 });
  assert.equal(pendingNoticeQuantities({ ...item, divergenceResolutionAction: 'credit_discount', quantityPendingStockEntry: 0 }), null);
  assert.equal(pendingNoticeQuantities({ ...item, status: 'cancelled' }), null);
  assert.equal(pendingNoticeQuantities({ ...item, noticeIgnoredAt: '2026-10-06' }), null);
  assert.throws(() => pendingNoticeQuantities({ ...item, quantityOrdered: -1 }));
});

test('ignore schema requires a reason and prevents document path injection', () => {
  const input = { purchaseReceiptId: 'r', purchaseReceiptItemId: 'i', destinationKioskId: 'unit-a', reason: 'Entrega não esperada' };
  assert.equal(ignoreNoticeSchema.safeParse(input).success, true);
  assert.equal(ignoreNoticeSchema.safeParse({ ...input, reason: '' }).success, false);
  assert.equal(ignoreNoticeSchema.safeParse({ ...input, purchaseReceiptItemId: 'other/items/i' }).success, false);
});

test('HTTP error boundary returns sanitized 403 for the exact server access guard', async () => {
  const user = actor(); user.permissions.stock.view = true;
  const handler = withApiErrorHandling({ source: 'api-purchasing', operation: 'test-notice-access', routeOrJob: '/test' }, async () => {
    assertNoticeAccess(user, 'unit-b', 'read');
    return NextResponse.json({ ok: true });
  });
  const response = await handler(new NextRequest('https://coala.test/test'), { params: Promise.resolve({}) });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'NOTICE_ACCESS_DENIED');
  assert.equal(typeof body.error.requestId, 'string');
});
