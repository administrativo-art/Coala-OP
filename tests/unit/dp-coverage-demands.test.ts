import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertsWhenUnitEmpty,
  buildDailyEmptyUnitCoverage,
  buildDailyOnDemandCoverage,
  coverageDemandRouteSchema,
  coverageDemandWindowsSchema,
  normalizeDPCoverageDemands,
  resolveDPCoverageMode,
} from '../../src/lib/dp-coverage-demands';
import type { DPShift } from '../../src/types';

function shift(userId: string, startTime: string, endTime: string): DPShift {
  return {
    id: `${userId}-${startTime}`,
    scheduleId: 'schedule-cd',
    unitId: 'centro-distribuicao',
    userId,
    date: '2026-09-04',
    startTime,
    endTime,
    type: 'work',
    createdAt: {} as DPShift['createdAt'],
  };
}

test('assume horário fixo para unidades antigas e respeita o modo explícito', () => {
  assert.equal(resolveDPCoverageMode({}), 'fixed_hours');
  assert.equal(resolveDPCoverageMode({ coverageMode: 'on_demand' }), 'on_demand');
  assert.equal(resolveDPCoverageMode({ coverageMode: 'disabled' }), 'disabled');
});

test('preserva o alerta das unidades antigas e só desliga as explicitamente desativadas', () => {
  assert.equal(alertsWhenUnitEmpty({}), true);
  assert.equal(alertsWhenUnitEmpty({ coverageMode: 'fixed_hours' }), true);
  assert.equal(alertsWhenUnitEmpty({ coverageMode: 'on_demand' }), true);
  assert.equal(alertsWhenUnitEmpty({ coverageMode: 'disabled' }), false);
});

test('avisa apenas quando não há turno de trabalho da unidade na data', () => {
  const date = '2026-09-04';
  assert.equal(buildDailyEmptyUnitCoverage({ date, shifts: [] }).gaps.length, 1);
  assert.equal(buildDailyEmptyUnitCoverage({ date, shifts: [{ date, type: 'day_off' }] }).gaps.length, 1);
  assert.equal(buildDailyEmptyUnitCoverage({ date, shifts: [shift('maria', '11:00', '11:30')] }).gaps.length, 0);
  assert.equal(buildDailyEmptyUnitCoverage({ date, shifts: [{ ...shift('maria', '11:00', '11:30'), date: '2026-09-05' }] }).gaps.length, 1);
});

test('rejeita intervalos sobrepostos e aceita intervalos adjacentes', () => {
  assert.equal(coverageDemandWindowsSchema.safeParse([
    { startTime: '09:00', endTime: '12:00', minimumPeople: 1 },
    { startTime: '11:30', endTime: '14:00', minimumPeople: 2 },
  ]).success, false);
  assert.equal(coverageDemandWindowsSchema.safeParse([
    { startTime: '09:00', endTime: '12:00', minimumPeople: 1 },
    { startTime: '12:00', endTime: '14:00', minimumPeople: 2 },
  ]).success, true);
});

test('rejeita datas inexistentes na rota de demanda', () => {
  assert.equal(coverageDemandRouteSchema.safeParse({ scheduleId: 'schedule-cd', date: '2026-09-31' }).success, false);
  assert.equal(coverageDemandRouteSchema.safeParse({ scheduleId: 'schedule-cd', date: '2026-09-30' }).success, true);
});

test('mede a quantidade mínima de pessoas por trecho da demanda', () => {
  const coverage = buildDailyOnDemandCoverage({
    date: '2026-09-04',
    windows: [{ startTime: '09:00', endTime: '15:00', minimumPeople: 2 }],
    shifts: [
      shift('maria', '09:00', '15:00'),
      shift('joana', '11:00', '14:00'),
    ],
  });

  assert.deepEqual(coverage.gaps, [
    { startTime: '09:00', endTime: '11:00', requiredPeople: 2, scheduledPeople: 1 },
    { startTime: '14:00', endTime: '15:00', requiredPeople: 2, scheduledPeople: 1 },
  ]);
});

test('não conta duas vezes a mesma pessoa e sinaliza equipe sem demanda', () => {
  const uncovered = buildDailyOnDemandCoverage({
    date: '2026-09-04',
    windows: [{ startTime: '09:00', endTime: '12:00', minimumPeople: 2 }],
    shifts: [
      shift('maria', '09:00', '12:00'),
      shift('maria', '09:00', '12:00'),
    ],
  });
  assert.equal(uncovered.gaps[0]?.scheduledPeople, 1);

  const withoutDemand = buildDailyOnDemandCoverage({
    date: '2026-09-04',
    windows: [],
    shifts: [shift('maria', '09:00', '12:00')],
  });
  assert.equal(withoutDemand.hasDemand, false);
  assert.equal(withoutDemand.hasUnplannedShifts, true);
});

test('descarta demandas persistidas com data ou conteúdo inválidos', () => {
  assert.deepEqual(normalizeDPCoverageDemands({
    '2026-09-04': [{ startTime: '09:00', endTime: '12:00', minimumPeople: 1, reason: 'Inventário' }],
    tomorrow: [{ startTime: '09:00', endTime: '12:00', minimumPeople: 1 }],
    '2026-09-05': [{ startTime: '12:00', endTime: '09:00', minimumPeople: 1 }],
  }), {
    '2026-09-04': [{ startTime: '09:00', endTime: '12:00', minimumPeople: 1, reason: 'Inventário' }],
  });
});
