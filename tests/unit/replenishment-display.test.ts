import assert from 'node:assert/strict';
import test from 'node:test';
import { availablePackages, getUnitsPerPackageForProduct, operationalMinimum, operationalDailyAverage, previewMinimum, shortage, supplyMode } from '../../src/lib/replenishment-display';
import type { BaseProduct, Product } from '../../src/types';

test('pending and partial never expose a stored zero as a calculated minimum', () => {
  for (const calculationStatus of ['pending', 'partial'] as const) {
    const result = operationalMinimum({ min: 0, override: false, calculationStatus, sourceLimitation: 'Fonte incompleta' }, true);
    assert.equal(result.minimum, null);
    assert.equal(shortage(result.minimum, 0), null);
    assert.match(result.label, /pendente/);
  }
  assert.equal(operationalMinimum({ min: 0, override: false }, null).minimum, null);
});

test('legacy operational minimum stays separate from new-policy preview', () => {
  const base = {
    id: 'base', name: 'Insumo', category: 'Massa', unit: 'g',
    stockLevels: { store: { min: 12, override: true } },
    replenishmentPreview: { store: { min: 25, override: false, calculationStatus: 'calculated', source: 'transfer_proxy' } },
  } as BaseProduct;
  assert.equal(operationalMinimum(base.stockLevels.store, false).minimum, 12);
  assert.equal(previewMinimum(base, 'store', false)?.minimum, 25);
  assert.equal(previewMinimum(base, 'store', true), null);
});

test('CD with no served units has a real zero target, without erasing its physical stock', () => {
  const minimum = operationalMinimum({ min: 0, override: false, calculationStatus: 'no_dependents' }, true);
  assert.equal(minimum.minimum, 0);
  assert.equal(minimum.status, 'no_dependents');
  assert.equal(shortage(minimum.minimum, 18), 0);
});

test('physical availability discounts reservation once before package conversion', () => {
  const base = { unit: 'g', category: 'Massa' } as BaseProduct;
  const product = { packageSize: 2, unit: 'kg', category: 'Massa' } as Product;
  const available = availablePackages(5, 2) * getUnitsPerPackageForProduct(product, base);
  assert.equal(available, 6000);
  assert.equal(shortage(8000, available), 2000);
  assert.equal(availablePackages(1, 4), 0);
});

test('direct route is explicit per base product and defaults to CD', () => {
  assert.equal(supplyMode({ override: false, supplyMode: 'direct', leadTime: 4 }), 'direct');
  assert.equal(supplyMode({ override: false }), 'cd');
});

test('active operational alerts use routed demand rather than the legacy whole-network average', () => {
  const level = { min: 39, override: false, calculationStatus: 'calculated' as const, avgDaily: 2 };
  assert.equal(operationalDailyAverage(level, true, 99), 2);
  assert.equal(operationalDailyAverage(level, false, 99), 99);
  assert.equal(operationalDailyAverage({ ...level, calculationStatus: 'pending' }, true, 99), null);
  assert.equal(operationalDailyAverage({ ...level, calculationStatus: 'no_dependents', min: 0 }, true, 99), 0);
  assert.equal(operationalDailyAverage({ ...level, avgDaily: undefined }, true, 99), null);
  assert.equal(operationalDailyAverage(level, null, 99), null);
});
