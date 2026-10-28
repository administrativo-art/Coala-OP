import assert from 'node:assert/strict';
import test from 'node:test';

import { operationalSelectionForUser, operationalUnitsDiffer } from '../../src/lib/collaborator-operational-selection';
import type { DPUnit } from '../../src/types';

const kiosks = [{ id: 'kiosk-a', name: 'Quiosque A' }];
const units = [{ id: 'unit-a', name: 'Quiosque A' }, { id: 'unit-cd', name: 'Centro de distribuição - Matriz' },
  { id: 'unit-finance', name: 'Quiosque Tirirical' }] as DPUnit[];

test('preserva unidade operacional legítima sem quiosque ao abrir o editor', () => {
  const selection = operationalSelectionForUser({ assignedKioskIds: ['kiosk-a'], unitIds: ['unit-a', 'unit-cd'] }, kiosks, units);
  assert.deepEqual(selection.selectedKioskIds, ['kiosk-a']);
  assert.deepEqual(selection.additionalUnitIds, ['unit-cd']);
});

test('preserva Tirirical como operacional adicional mesmo sendo também financeiro', () => {
  const selection = operationalSelectionForUser({ assignedKioskIds: ['kiosk-a'], unitIds: ['unit-finance'] }, kiosks, units);
  assert.deepEqual(selection.selectedKioskIds, ['kiosk-a']);
  assert.deepEqual(selection.additionalUnitIds, ['unit-finance']);
  assert.equal(operationalUnitsDiffer(['unit-finance'], ['unit-a', ...selection.additionalUnitIds]), true);
  assert.equal(operationalUnitsDiffer(['unit-finance', 'unit-a'], ['unit-a', ...selection.additionalUnitIds]), false);
});
