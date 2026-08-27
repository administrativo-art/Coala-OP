import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  convertValue,
  getUnitsForCategory,
  normalizeMeasurementUnit,
} from '../../src/lib/conversion';

test('expõe apenas un como unidade canônica de contagem', () => {
  assert.deepEqual(getUnitsForCategory('Unidade'), ['un', 'pacote', 'bag', 'caixa']);
  assert.equal(getUnitsForCategory('Unidade').includes('unidade'), false);
});

test('mantém compatibilidade de conversão com o alias legado unidade', () => {
  assert.equal(normalizeMeasurementUnit('unidade'), 'un');
  assert.equal(normalizeMeasurementUnit(' UNIDADE '), 'un');
  assert.equal(convertValue(12, 'unidade', 'un', 'Unidade'), 12);
});
