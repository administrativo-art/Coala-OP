import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBaseProductStockLevels, writableBaseProductPayload } from '../../src/lib/base-product-stock-levels';

test('active policy preserves calculated fields and rejects manual minimum', () => {
  const existing = { kiosk: { min: 12, override: true, calculationStatus: 'calculated' as const,
    source: 'pdv_internal' as const, leadTime: 2 } };
  const result = parseBaseProductStockLevels({
    kiosk: { min: 99, override: true, supplyMode: 'cd', leadTime: 8 },
  }, existing, () => true, true);
  assert.equal(result.kiosk.min, 12);
  assert.equal(result.kiosk.override, false);
  assert.equal(result.kiosk.calculationStatus, 'calculated');
  assert.equal(result.kiosk.leadTime, 8);
});

test('shadow policy preserves legacy manual behavior until enabled', () => {
  const result = parseBaseProductStockLevels({ kiosk: { min: 99, override: true, leadTime: 0 } },
    {}, () => true, false);
  assert.equal(result.kiosk.min, 99);
  assert.equal(result.kiosk.override, true);
});

test('direct route requires positive local lead and unit access', () => {
  assert.throws(() => parseBaseProductStockLevels({ kiosk: { supplyMode: 'direct', leadTime: 0 } },
    {}, () => true), /prazo positivo/);
  assert.throws(() => parseBaseProductStockLevels({ kiosk: { supplyMode: 'cd' } },
    {}, () => false), /sem acesso/);
  assert.equal(parseBaseProductStockLevels({ kiosk: { supplyMode: 'direct', leadTime: 4 } },
    {}, () => true).kiosk.leadTime, 4);
});

test('server-owned comparison/version cannot be supplied by the client', () => {
  assert.deepEqual(writableBaseProductPayload({ name: 'Limão', replenishmentPreview: { cd: { min: 999 } },
    replenishmentPolicyVersion: 999 }), { name: 'Limão' });
});

test('explicit legacy edit clears obsolete active-policy pending marker after rollback', () => {
  const result = parseBaseProductStockLevels({ kiosk: { min: 12, override: true } },
    { kiosk: { min: 0, override: false, calculationStatus: 'pending' } }, () => true, false);
  assert.equal(result.kiosk.min, 12);
  assert.equal(result.kiosk.calculationStatus, undefined);
});
