import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateGrossMargin,
  calculatePriceSpread,
  getPricingCommercialStatus,
  hasAbnormalCmv,
} from '../../src/lib/pricing-insights';

test('classifica prejuízo antes da meta comercial', () => {
  assert.equal(getPricingCommercialStatus(9, 10, 50), 'loss');
  assert.equal(getPricingCommercialStatus(0, 10, 50), 'loss');
  assert.equal(getPricingCommercialStatus(20, 10, 60), 'below');
  assert.equal(getPricingCommercialStatus(25, 10, 60), 'met');
  assert.equal(getPricingCommercialStatus(25, 10, null), 'none');
});

test('calcula margem, CMV anormal e divergência entre canais', () => {
  assert.deepEqual(calculateGrossMargin(20, 8), { value: 12, percentage: 60 });
  assert.equal(hasAbnormalCmv(10, 6.01), true);
  assert.equal(hasAbnormalCmv(10, 6), false);
  assert.equal(calculatePriceSpread([20, 27, 25]), 35);
  assert.equal(calculatePriceSpread([20, null]), 0);
});
