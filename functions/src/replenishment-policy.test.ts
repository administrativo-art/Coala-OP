import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateReplenishment, effectiveLeadTime, physicalShortage, historyStart, historyEnd,
} from './replenishment-policy.js';

const days = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, '0')}`, quantity: 10, usable: true,
}));

test('monthly and biweekly targets use valid daily average with one 30% margin', () => {
  assert.equal(calculateReplenishment({ days, cycleDays: 30, unit: 'un', source: 'pdv_internal' }).target, 390);
  assert.equal(calculateReplenishment({ days, cycleDays: 15, unit: 'un', source: 'pdv_internal' }).target, 195);
});

test('partial and absent reports remain pending, not zeros', () => {
  const partial = calculateReplenishment({ days: days.slice(0, 13), cycleDays: 30, unit: 'kg', source: 'pdv_internal' });
  assert.equal(partial.target, null);
  assert.equal(partial.calculationStatus, 'partial');
  const absent = calculateReplenishment({ days: [], cycleDays: 30, unit: 'kg', source: 'none' });
  assert.equal(absent.target, null);
  assert.equal(absent.calculationStatus, 'pending');
});

test('CD with no dependent units zeros even with an old manual override', () => {
  const value = calculateReplenishment({ days: [], cycleDays: 30, unit: 'kg',
    source: 'none', isSupplyUnit: true, servedUnitCount: 0 });
  assert.equal(value.target, 0);
  assert.equal(value.calculationStatus, 'no_dependents');
});

test('lead time and physical shortage remain separate from target and inbound', () => {
  assert.equal(effectiveLeadTime('cd', 7), 2);
  assert.equal(effectiveLeadTime('cd', 7, true), 7);
  assert.equal(effectiveLeadTime('cd', 0, true), 2);
  assert.equal(effectiveLeadTime('direct', 5), 5);
  assert.equal(effectiveLeadTime('direct', 0), null);
  assert.equal(physicalShortage(20, 8), 12);
  assert.equal(physicalShortage(20, -8), 20);
  assert.equal(physicalShortage(null, 8), null);
});

test('180 complete Belém days exclude today', () => {
  const now = new Date('2026-10-06T03:00:00.000Z');
  assert.equal(historyEnd(now), '2026-10-05');
  assert.equal(historyStart(now), '2026-04-09');
});
