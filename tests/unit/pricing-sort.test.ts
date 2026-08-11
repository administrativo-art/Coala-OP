import test from 'node:test';
import assert from 'node:assert/strict';

import { comparePricingSkus } from '../../src/lib/pricing-sort';

test('envia SKUs iniciados por 00000 ao fim na ordem decrescente', () => {
  const skus = ['000003', '400', '000001', '1200', '000002'];

  assert.deepEqual(
    skus.sort((first, second) => comparePricingSkus(first, second, 'desc')),
    ['1200', '400', '000003', '000002', '000001'],
  );
});

test('preserva a ordenação numérica normal na ordem crescente', () => {
  const skus = ['000003', '400', '000001', '1200', '000002'];

  assert.deepEqual(
    skus.sort((first, second) => comparePricingSkus(first, second, 'asc')),
    ['000001', '000002', '000003', '400', '1200'],
  );
});
