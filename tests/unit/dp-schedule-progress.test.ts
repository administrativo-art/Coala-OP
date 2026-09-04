import assert from 'node:assert/strict';
import test from 'node:test';

import { countExpectedDPUnitDays, countFilledDPShiftDays } from '../../src/lib/dp-schedule-progress';
import type { DPShiftDefinition, DPUnit } from '../../src/types';

const createdAt = {} as DPUnit['createdAt'];

test('on-demand units do not expose an artificial expected-shift target', () => {
  const unit: DPUnit = {
    id: 'distribution-center',
    name: 'Centro de distribuição',
    coverageMode: 'on_demand',
    createdAt,
  };

  assert.equal(countExpectedDPUnitDays({
    unit,
    year: 2026,
    month: 9,
    shiftDefinitions: [],
  }), null);
});

test('filled days count unique work dates and ignore day-off records', () => {
  assert.equal(countFilledDPShiftDays([
    { type: 'work', date: '2026-09-01' },
    { type: 'work', date: '2026-09-01' },
    { type: 'day_off', date: '2026-09-02' },
    { type: 'work', date: '2026-09-03' },
  ]), 2);
});

test('fixed-hours units count calendar days covered by their linked shifts', () => {
  const unit: DPUnit = {
    id: 'shopping-automovel',
    name: 'Shopping do Automóvel',
    coverageMode: 'fixed_hours',
    createdAt,
  };
  const shiftDefinitions: DPShiftDefinition[] = [
    {
      id: 'morning',
      code: 'M',
      name: 'Manhã',
      startTime: '09:00',
      endTime: '15:00',
      unitIds: [unit.id],
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt,
    },
    {
      id: 'afternoon',
      code: 'T',
      name: 'Tarde',
      startTime: '15:00',
      endTime: '21:00',
      unitIds: [unit.id],
      daysOfWeek: [1, 2, 3, 4, 5, 6],
      createdAt,
    },
  ];

  assert.equal(countExpectedDPUnitDays({ unit, year: 2026, month: 9, shiftDefinitions }), 30);
});
