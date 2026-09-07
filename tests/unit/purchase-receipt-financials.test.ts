import assert from 'node:assert/strict';
import test from 'node:test';

import { computeReceiptFinancialUpdate } from '../../src/lib/purchase-receipt-financials';

test('amountConfirmed includes the delivery fee, not just goods', () => {
  const result = computeReceiptFinancialUpdate({
    totalConfirmed: 375.85,
    deliveryFee: 9.99,
    amountEstimated: 385.84,
    receiptMode: 'future_delivery',
    hasRemaining: false,
    hasDivergence: false,
  });
  assert.ok(Math.abs(result.amountConfirmed - 385.84) < 0.001);
  assert.equal(result.status, 'confirmed');
});

test('does not flag divergence when goods + freight match the estimate, even with freight > 0', () => {
  // Regression: comparing goods-only totalConfirmed against a goods+freight
  // amountEstimated used to flag every future_delivery order with freight
  // as divergent, off by exactly the freight amount.
  const result = computeReceiptFinancialUpdate({
    totalConfirmed: 375.85,
    deliveryFee: 9.99,
    amountEstimated: 385.84,
    receiptMode: 'future_delivery',
    hasRemaining: false,
    hasDivergence: false,
  });
  assert.equal(result.status, 'confirmed');
});

test('flags divergence when the confirmed total genuinely differs from the estimate', () => {
  const result = computeReceiptFinancialUpdate({
    totalConfirmed: 314.44,
    deliveryFee: 9.99,
    amountEstimated: 385.84,
    receiptMode: 'future_delivery',
    hasRemaining: false,
    hasDivergence: false,
  });
  assert.equal(result.amountConfirmed, 324.43);
  assert.equal(result.status, 'divergent');
});

test('ignores the estimate comparison outside future_delivery mode', () => {
  const result = computeReceiptFinancialUpdate({
    totalConfirmed: 100,
    deliveryFee: 0,
    amountEstimated: 385.84,
    receiptMode: 'immediate',
    hasRemaining: false,
    hasDivergence: false,
  });
  assert.equal(result.status, 'confirmed');
});

test('hasRemaining takes priority over divergence', () => {
  const result = computeReceiptFinancialUpdate({
    totalConfirmed: 0,
    deliveryFee: 0,
    amountEstimated: 385.84,
    receiptMode: 'future_delivery',
    hasRemaining: true,
    hasDivergence: true,
  });
  assert.equal(result.status, 'forecasted');
});
