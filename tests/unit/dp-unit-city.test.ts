import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCityFromDPUnitAddress,
  resolveDPUnitCity,
  UNDEFINED_DP_UNIT_CITY,
} from '../../src/lib/dp-unit-city';

test('prioritizes the city configured in the holiday calendar', () => {
  assert.equal(resolveDPUnitCity({
    calendarCity: 'São Luís',
    address: 'Av. Central, Belém - PA',
    groupName: 'Operação Norte',
  }), 'São Luís');
});

test('extracts the city from common unit address formats', () => {
  assert.equal(extractCityFromDPUnitAddress('Av. Central, 10, São Luís - MA'), 'São Luís');
  assert.equal(extractCityFromDPUnitAddress('Av. Central, 10, Belém, PA, 66000-000'), 'Belém');
});

test('uses the organizational group and then the undefined fallback', () => {
  assert.equal(resolveDPUnitCity({ groupName: 'Imperatriz' }), 'Imperatriz');
  assert.equal(resolveDPUnitCity({}), UNDEFINED_DP_UNIT_CITY);
});
