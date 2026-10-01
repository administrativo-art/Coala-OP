import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { natashaCoveragePlanSchema } from '../../src/lib/natasha-roster-coverage';
import { natashaProposalInputsSchema } from '../../src/lib/natasha-proposal-preflight';
import { generateNatashaAlternatives } from '../../src/lib/natasha-roster-solver';
import { natashaRosterSnapshotSchema } from '../../src/lib/natasha-roster-validator';

function fixtures() {
  const snapshot = natashaRosterSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-history-synthetic.json', 'utf8')) as unknown);
  const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-coverage-synthetic.json', 'utf8')) as unknown);
  const inputs = natashaProposalInputsSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-proposal-inputs-synthetic.json', 'utf8')) as unknown);
  return { snapshot, plan, inputs };
}

function openDay(plan: ReturnType<typeof fixtures>['plan'], date: string, startTime: string, endTime: string) {
  const day = plan.units[0].days.find((item) => item.date === date)!;
  day.status = 'open';
  day.windows = [{ startTime, endTime, minimumPeople: 1 }];
}

test('gera alternativas distintas, determinísticas e mantém sexta fixa', () => {
  const { snapshot, plan, inputs } = fixtures();
  inputs.employees.push(
    { id: 'ana', active: true, allowedUnitIds: ['matriz'], roleIds: [] },
    { id: 'bia', active: true, allowedUnitIds: ['matriz'], roleIds: [] },
  );
  openDay(plan, '2026-10-03', '09:00', '17:00');
  inputs.positions.push({ id: 'm-03', unitId: 'matriz', date: '2026-10-03', startTime: '09:00', endTime: '17:00', slot: 'single', requiredRoleId: null });
  const first = generateNatashaAlternatives(snapshot, plan, inputs, { minDifferentAssignments: 1 });
  const second = generateNatashaAlternatives(snapshot, plan, inputs, { minDifferentAssignments: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.status, 'alternatives');
  assert.equal(first.search.exhaustive, true);
  assert.equal(first.alternatives.length, 3);
  assert.deepEqual(new Set(first.alternatives.map((alternative) => alternative.assignments.find((item) => item.positionId === 'm-03')?.employeeId)), new Set(['ana', 'bia', 'leader']));
  for (const alternative of first.alternatives) {
    assert.ok(alternative.assignments.filter((item) => item.date.endsWith('02') || item.date.endsWith('09')
      || item.date.endsWith('16') || item.date.endsWith('23') || item.date.endsWith('30'))
      .every((item) => item.employeeId === 'leader'));
  }
});

test('11h entre setembro e outubro e compromisso de novembro eliminam candidato', () => {
  const { snapshot, plan, inputs } = fixtures();
  inputs.employees.push({ id: 'ana', active: true, allowedUnitIds: ['matriz'], roleIds: [] });
  snapshot.shifts.push({ id: 'sep-close', employeeId: 'ana', unitId: 'matriz', date: '2026-09-30', startTime: '14:00', endTime: '22:00', slot: 'closing' });
  openDay(plan, '2026-10-01', '08:00', '16:00');
  inputs.positions.push({ id: 'm-01', unitId: 'matriz', date: '2026-10-01', startTime: '08:00', endTime: '16:00', slot: 'opening', requiredRoleId: null });
  inputs.nextMonthKnownShifts.push({ employeeId: 'ana', unitId: 'matriz', date: '2026-11-01', startTime: '09:00', endTime: '17:00' });
  openDay(plan, '2026-10-31', '14:00', '23:00');
  inputs.positions.push({ id: 'm-31', unitId: 'matriz', date: '2026-10-31', startTime: '14:00', endTime: '23:00', slot: 'closing', requiredRoleId: null });
  const report = generateNatashaAlternatives(snapshot, plan, inputs);
  assert.equal(report.status, 'alternatives');
  assert.ok(report.alternatives.every((alternative) => alternative.assignments.find((item) => item.positionId === 'm-01')?.employeeId === 'leader'));
  assert.ok(report.alternatives.every((alternative) => alternative.assignments.find((item) => item.positionId === 'm-31')?.employeeId === 'leader'));
});

test('data fixa, férias e ausência de solução são tratadas como restrições', () => {
  const { snapshot, plan, inputs } = fixtures();
  inputs.employees.push({ id: 'ana', active: true, allowedUnitIds: ['matriz'], roleIds: [] });
  openDay(plan, '2026-10-03', '09:00', '17:00');
  inputs.positions.push({ id: 'm-03', unitId: 'matriz', date: '2026-10-03', startTime: '09:00', endTime: '17:00', slot: 'single', requiredRoleId: null });
  snapshot.fixedAssignments.push({ employeeId: 'ana', unitId: 'matriz', date: '2026-10-03' });
  const fixed = generateNatashaAlternatives(snapshot, plan, inputs);
  assert.equal(fixed.status, 'alternatives');
  assert.equal(fixed.alternatives[0].assignments.find((item) => item.positionId === 'm-03')?.employeeId, 'ana');
  snapshot.vacations.push({ employeeId: 'ana', startDate: '2026-10-01', endDate: '2026-10-05', recordType: 'gozo', status: 'approved' });
  const vacation = generateNatashaAlternatives(snapshot, plan, inputs);
  assert.equal(vacation.status, 'infeasible');
  assert.ok(vacation.preflight.issues.some((issue) => issue.code === 'FIXED_ASSIGNMENT_WITHOUT_POSITION'));

  const impossible = fixtures();
  impossible.inputs.positions.push({ id: 'm-02-b', unitId: 'matriz', date: '2026-10-02', startTime: '09:00', endTime: '17:00', slot: 'single', requiredRoleId: 'lider' });
  const noSolution = generateNatashaAlternatives(impossible.snapshot, impossible.plan, impossible.inputs);
  assert.equal(noSolution.status, 'infeasible');
  assert.equal(noSolution.search.exhaustive, true);
});

test('limite de busca é declarado, sem atribuir inviabilidade', () => {
  const { snapshot, plan, inputs } = fixtures();
  const report = generateNatashaAlternatives(snapshot, plan, inputs, { maxNodes: 1 });
  assert.equal(report.status, 'search_limit');
  assert.equal(report.search.limitReached, true);
  assert.equal(report.search.exhaustive, false);
  assert.deepEqual(report.alternatives, []);
});

test('preferência configurada favorece Sara nos intermediários dos dois quiosques', () => {
  const { snapshot, plan, inputs } = fixtures();
  const tirirical = structuredClone(plan.units[0]);
  const shopping = structuredClone(plan.units[0]);
  tirirical.unitId = 'tirirical';
  shopping.unitId = 'shopping';
  for (const unit of [tirirical, shopping]) {
    for (const day of unit.days) {
      day.status = 'closed';
      day.windows = [];
    }
  }
  plan.expectedUnitIds.push('tirirical', 'shopping');
  plan.units.push(tirirical, shopping);
  const tDay = tirirical.days.find((item) => item.date === '2026-10-03')!;
  tDay.status = 'open';
  tDay.windows = [{ startTime: '12:00', endTime: '16:00', minimumPeople: 1 }];
  const sDay = shopping.days.find((item) => item.date === '2026-10-10')!;
  sDay.status = 'open';
  sDay.windows = [{ startTime: '12:00', endTime: '16:00', minimumPeople: 1 }];
  inputs.employees.push(
    { id: 'sara', active: true, allowedUnitIds: ['tirirical', 'shopping'], roleIds: [] },
    { id: 'outra', active: true, allowedUnitIds: ['tirirical', 'shopping'], roleIds: [] },
  );
  inputs.positions.push(
    { id: 't-03', unitId: 'tirirical', date: '2026-10-03', startTime: '12:00', endTime: '16:00', slot: 'intermediate', requiredRoleId: null },
    { id: 's-10', unitId: 'shopping', date: '2026-10-10', startTime: '12:00', endTime: '16:00', slot: 'intermediate', requiredRoleId: null },
  );
  const report = generateNatashaAlternatives(snapshot, plan, inputs, {
    minDifferentAssignments: 1,
    weights: { openingAfterClosing: 0, shiftSpread: 0, sundaySpread: 0, saraMix: 10 },
    saraPreference: { employeeId: 'sara', tiriricalUnitId: 'tirirical', shoppingUnitId: 'shopping' },
  });
  assert.equal(report.status, 'alternatives');
  assert.equal(report.alternatives[0].metrics.saraMix, 0);
  assert.equal(report.alternatives[0].assignments.find((item) => item.positionId === 't-03')?.employeeId, 'sara');
  assert.equal(report.alternatives[0].assignments.find((item) => item.positionId === 's-10')?.employeeId, 'sara');
});

test('CLI gera relatório apenas com arquivos sintéticos', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-generate.mts',
    '--snapshot', 'tests/fixtures/natasha-history-synthetic.json',
    '--plan', 'tests/fixtures/natasha-coverage-synthetic.json',
    '--inputs', 'tests/fixtures/natasha-proposal-inputs-synthetic.json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string; alternatives: unknown[] };
  assert.equal(report.status, 'alternatives');
  assert.equal(report.alternatives.length, 1);
});
