import assert from 'node:assert/strict';
import test from 'node:test';

import { isConfirmedOrderAwaitingReceipt } from '../../src/lib/purchasing-receipt-queue';

test('includes confirmed orders without a final receipt timestamp', () => {
  assert.equal(
    isConfirmedOrderAwaitingReceipt({ status: 'confirmed', receivedAt: undefined }),
    true,
  );
});

test('excludes confirmed orders after the final receipt', () => {
  assert.equal(
    isConfirmedOrderAwaitingReceipt({
      status: 'confirmed',
      receivedAt: '2026-09-04T18:00:00.000Z',
    }),
    false,
  );
});

test('excludes orders that have not been confirmed or were cancelled', () => {
  assert.equal(
    isConfirmedOrderAwaitingReceipt({ status: 'created', receivedAt: undefined }),
    false,
  );
  assert.equal(
    isConfirmedOrderAwaitingReceipt({ status: 'cancelled', receivedAt: undefined }),
    false,
  );
  assert.equal(isConfirmedOrderAwaitingReceipt(undefined), false);
});
