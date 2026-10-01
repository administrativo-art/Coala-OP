import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  natashaCoveragePlanSchema,
  validateNatashaCoverage,
  type NatashaCoveragePlan,
} from '../../src/lib/natasha-roster-coverage';
import type { NatashaRosterSnapshot } from '../../src/lib/natasha-roster-validator';

function dates(): string[] {
  return Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
}

function plan(): NatashaCoveragePlan {
  return {
    period: '2026-10', expectedUnitIds: ['tirirical'], scopeConfirmed: true,
    units: [{ unitId: 'tirirical', days: dates().map((date) => date === '2026-10-02'
      ? { date, status: 'open' as const, windows: [{ startTime: '09:00', endTime: '21:00', minimumPeople: 1 }] }
      : { date, status: 'closed' as const, windows: [] as [] }) }],
  };
}

function snapshot(): NatashaRosterSnapshot {
  return {
    period: '2026-10', history: { from: '2026-09-17', through: '2026-09-30', complete: true },
    shifts: [
      { id: 'a', employeeId: 'carliane', unitId: 'tirirical', date: '2026-10-02', startTime: '09:00', endTime: '15:00', slot: 'opening' },
      { id: 'b', employeeId: 'thaise', unitId: 'tirirical', date: '2026-10-02', startTime: '15:00', endTime: '21:00', slot: 'closing' },
    ],
    dayOffs: [], vacations: [], unavailabilities: [], fixedAssignments: [], fridayMatrix: null,
  };
}

test('cobertura de um dia completo com troca de pessoa no limite da janela', () => {
  const report = validateNatashaCoverage(snapshot(), plan());
  assert.equal(report.status, 'checked');
  assert.equal(report.checkedWindows, 1);
  assert.deepEqual(report.issues, []);
});

test('lacuna segmentada informa minutos e efetivo exatos', () => {
  const input = snapshot();
  input.shifts[1].startTime = '16:00';
  const report = validateNatashaCoverage(input, plan());
  assert.equal(report.status, 'gaps');
  assert.deepEqual(report.issues, [{
    code: 'COVERAGE_GAP', category: 'coverage', unitId: 'tirirical', date: '2026-10-02',
    startTime: '15:00', endTime: '16:00', requiredPeople: 1, scheduledPeople: 0,
  }]);
});

test('duas pessoas exigidas contam IDs distintos, sem duplicar turnos da mesma pessoa', () => {
  const demand = plan();
  const day = demand.units[0].days.find((item) => item.date === '2026-10-02');
  if (!day || day.status !== 'open') throw new Error('Fixture inválida.');
  day.windows[0].minimumPeople = 2;
  const input = snapshot();
  input.shifts[1].employeeId = 'carliane';
  const report = validateNatashaCoverage(input, demand);
  assert.equal(report.status, 'gaps');
  assert.deepEqual(report.issues.map((issue) => [issue.startTime, issue.endTime, issue.scheduledPeople]), [
    ['09:00', '21:00', 1],
  ]);
});

test('não certifica unidade ou dia sem declaração, nem escopo não confirmado', () => {
  const demand = plan();
  demand.expectedUnitIds.push('shopping');
  demand.scopeConfirmed = false;
  demand.units[0].days.pop();
  const report = validateNatashaCoverage(snapshot(), demand);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((issue) => issue.code === 'SCOPE_UNCONFIRMED'));
  assert.ok(report.issues.some((issue) => issue.code === 'UNIT_MISSING' && issue.unitId === 'shopping'));
  assert.ok(report.issues.some((issue) => issue.code === 'DAY_MISSING' && issue.date === '2026-10-31'));
});

test('não inclui unidades de fora da demanda no atestado', () => {
  const input = snapshot();
  input.shifts.push({ id: 'c', employeeId: 'sara', unitId: 'shopping', date: '2026-10-02', startTime: '10:00', endTime: '18:00' });
  const report = validateNatashaCoverage(input, plan());
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((issue) => issue.code === 'SHIFT_OUTSIDE_SCOPE'));
});

test('trabalho em dia declarado fechado exige esclarecimento', () => {
  const input = snapshot();
  input.shifts.push({ id: 'c', employeeId: 'sara', unitId: 'tirirical', date: '2026-10-03', startTime: '10:00', endTime: '18:00' });
  const report = validateNatashaCoverage(input, plan());
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((issue) => issue.code === 'SHIFT_ON_CLOSED_DAY' && issue.date === '2026-10-03'));
});

test('contrato recusa datas repetidas, sobreposição de janelas e horário invertido', () => {
  const duplicate = plan();
  duplicate.units[0].days[30] = duplicate.units[0].days[0];
  assert.equal(natashaCoveragePlanSchema.safeParse(duplicate).success, false);

  const overlapping = plan();
  const day = overlapping.units[0].days.find((item) => item.date === '2026-10-02');
  if (!day || day.status !== 'open') throw new Error('Fixture inválida.');
  day.windows.push({ startTime: '20:00', endTime: '22:00', minimumPeople: 1 });
  assert.equal(natashaCoveragePlanSchema.safeParse(overlapping).success, false);

  day.windows[1].startTime = '22:00';
  day.windows[1].endTime = '21:00';
  assert.equal(natashaCoveragePlanSchema.safeParse(overlapping).success, false);
});

test('competência divergente impede relatório completo', () => {
  const input = snapshot();
  input.period = '2026-11';
  const report = validateNatashaCoverage(input, plan());
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((issue) => issue.code === 'PERIOD_MISMATCH'));
});

test('CLI confere os dois arquivos sintéticos sem acesso externo', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-coverage.mts',
    '--snapshot', 'tests/fixtures/natasha-roster-synthetic.json',
    '--plan', 'tests/fixtures/natasha-coverage-synthetic.json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((JSON.parse(result.stdout) as { status: string }).status, 'checked');
});
