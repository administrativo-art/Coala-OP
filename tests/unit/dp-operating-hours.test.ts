import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDailyUnitCoverage,
  dpOperatingHoursSchema,
  emptyOperatingHours,
} from '../../src/lib/dp-operating-hours';
import type { DPOperatingHours, DPShift } from '../../src/types';

function weekdayHours(startTime = '09:00', endTime = '21:00'): DPOperatingHours {
  return {
    ...emptyOperatingHours(),
    '4': { isOpen: true, startTime, endTime },
  };
}

function shift(id: string, startTime: string, endTime: string, type: DPShift['type'] = 'work'): DPShift {
  return {
    id,
    scheduleId: 'schedule-shopping',
    unitId: 'shopping',
    userId: `user-${id}`,
    date: '2026-09-03',
    startTime,
    endTime,
    type,
    createdAt: {} as DPShift['createdAt'],
  };
}

test('valida os sete dias e exige encerramento posterior à abertura', () => {
  assert.equal(dpOperatingHoursSchema.safeParse(weekdayHours()).success, true);
  assert.equal(dpOperatingHoursSchema.safeParse(weekdayHours('21:00', '09:00')).success, false);
  assert.equal(dpOperatingHoursSchema.safeParse({ '4': { isOpen: false } }).success, false);
});

test('identifica o intervalo descoberto quando existe somente o turno da manhã', () => {
  const coverage = buildDailyUnitCoverage({
    date: '2026-09-03',
    operatingHours: weekdayHours(),
    shifts: [shift('maria', '09:00', '15:15')],
  });

  assert.deepEqual(coverage.gaps, [{ startTime: '15:15', endTime: '21:00' }]);
});

test('considera cobertura contínua quando os turnos se sobrepõem', () => {
  const coverage = buildDailyUnitCoverage({
    date: '2026-09-03',
    operatingHours: weekdayHours(),
    shifts: [
      shift('maria', '09:00', '15:15'),
      shift('heucilene', '14:45', '21:00'),
    ],
  });

  assert.deepEqual(coverage.gaps, []);
});

test('folga não conta como cobertura operacional', () => {
  const coverage = buildDailyUnitCoverage({
    date: '2026-09-03',
    operatingHours: weekdayHours(),
    shifts: [shift('aliny', '', '', 'day_off')],
  });

  assert.deepEqual(coverage.gaps, [{ startTime: '09:00', endTime: '21:00' }]);
});

test('não cria alerta antes da configuração nem em dia fechado', () => {
  assert.deepEqual(buildDailyUnitCoverage({
    date: '2026-09-03',
    shifts: [],
  }).gaps, []);

  assert.deepEqual(buildDailyUnitCoverage({
    date: '2026-09-03',
    operatingHours: emptyOperatingHours(),
    shifts: [],
  }).gaps, []);
});

test('ignora configuração persistida inválida sem quebrar a escala', () => {
  assert.deepEqual(buildDailyUnitCoverage({
    date: '2026-09-03',
    operatingHours: { '4': { isOpen: true } } as unknown as DPOperatingHours,
    shifts: [],
  }).gaps, []);
});
