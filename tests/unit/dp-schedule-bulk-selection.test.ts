import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVisibleSchedulePeople } from '../../src/lib/dp-schedule-bulk-selection';

test('seleção visível ignora semanas recolhidas e respeita o filtro de dias', () => {
  const shifts = {
    '2026-11-01': { unit: [{ id: 'hidden', userId: 'person-a' }] },
    '2026-11-08': { unit: [{ id: 'visible', userId: 'person-a' }] },
    '2026-11-15': { unit: [{ id: 'filtered-out', userId: 'person-a' }] },
  };
  const people = new Map([['person-a', { username: 'Carliane' }]]);
  const filteredDays = [
    { date: '2026-11-01', week: 1 },
    { date: '2026-11-08', week: 2 },
  ];

  assert.deepEqual(buildVisibleSchedulePeople(filteredDays, new Set([1, 2]), shifts, people), []);
  assert.deepEqual(buildVisibleSchedulePeople(filteredDays, new Set([1]), shifts, people), [
    { id: 'person-a', name: 'Carliane', shiftIds: ['visible'] },
  ]);
});
