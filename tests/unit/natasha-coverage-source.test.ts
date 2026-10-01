import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { natashaCoverageSourceSchema, prepareNatashaCoverageFromCoala } from '../../src/lib/natasha-coverage-source';
import { natashaCoveragePlanSchema } from '../../src/lib/natasha-roster-coverage';

function fixture() {
  return natashaCoverageSourceSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-coverage-source-synthetic.json', 'utf8')) as unknown);
}

test('projeta horário fixo somente com mínimo e exceções confirmados', () => {
  const report = prepareNatashaCoverageFromCoala(fixture());
  const expected = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-coverage-synthetic.json', 'utf8')) as unknown);
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.resolvedDays, 31);
  assert.deepEqual(report.plan, expected);
});

test('mínimo desconhecido ou calendário não confirmado não vira demanda pronta', () => {
  const missing = fixture();
  missing.fixedHoursMinimumPeople = {};
  const incomplete = prepareNatashaCoverageFromCoala(missing);
  assert.equal(incomplete.status, 'questions_pending');
  assert.equal(incomplete.plan, null);
  assert.ok(incomplete.issues.some((item) => item.code === 'MINIMUM_UNKNOWN' && item.date === '2026-10-02'));

  const unconfirmed = fixture();
  unconfirmed.confirmed.dailyOpeningsAndExceptions = false;
  const draft = prepareNatashaCoverageFromCoala(unconfirmed);
  assert.equal(draft.status, 'questions_pending');
  assert.equal(draft.plan?.scopeConfirmed, false);
  assert.ok(draft.issues.some((item) => item.code === 'CONFIRM_DAILY_OPENINGS'));
});

test('demanda sob demanda ausente não é interpretada como unidade fechada', () => {
  const source = fixture();
  source.units[0].coverageMode = 'on_demand';
  source.schedules.push({ id: 'escala-m', unitId: 'matriz', year: 2026, month: 10,
    coverageDemands: { '2026-10-02': [{ startTime: '09:00', endTime: '17:00', minimumPeople: 2 }] } });
  const report = prepareNatashaCoverageFromCoala(source);
  assert.equal(report.status, 'questions_pending');
  assert.equal(report.plan, null);
  assert.equal(report.resolvedDays, 1);
  assert.ok(report.issues.some((item) => item.code === 'ON_DEMAND_DAY_UNKNOWN' && item.date === '2026-10-03'));
});

test('demanda sob demanda e fechamentos explícitos produzem plano completo', () => {
  const source = fixture();
  source.units[0].coverageMode = 'on_demand';
  source.schedules.push({ id: 'escala-m', unitId: 'matriz', year: 2026, month: 10,
    coverageDemands: { '2026-10-02': [{ startTime: '09:00', endTime: '17:00', minimumPeople: 2 }] } });
  for (let day = 1; day <= 31; day += 1) {
    if (day === 2) continue;
    source.overrides.push({ unitId: 'matriz', date: `2026-10-${String(day).padStart(2, '0')}`,
      day: { status: 'closed', windows: [] }, reason: 'Fechamento diário confirmado' });
  }
  const report = prepareNatashaCoverageFromCoala(source);
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.plan?.units[0].days.find((item) => item.date === '2026-10-02')?.windows[0]?.minimumPeople, 2);
  source.schedules[0].coverageDemands = { '2026-10-02': [
    { startTime: '09:00', endTime: '14:00', minimumPeople: 1 },
    { startTime: '13:00', endTime: '17:00', minimumPeople: 1 },
  ] };
  assert.throws(() => prepareNatashaCoverageFromCoala(source));
});

test('exceção explícita fecha dia e exige justificativa', () => {
  const source = fixture();
  source.overrides.push({ unitId: 'matriz', date: '2026-10-02', day: { status: 'closed', windows: [] }, reason: 'Fechamento confirmado' });
  const report = prepareNatashaCoverageFromCoala(source);
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.plan?.units[0].days.find((item) => item.date === '2026-10-02')?.status, 'closed');
  source.overrides[0].reason = '';
  assert.throws(() => prepareNatashaCoverageFromCoala(source));
});

test('CLI só lê fixture sintética e não grava plano', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-prepare-coverage.mts',
    '--input', 'tests/fixtures/natasha-coverage-source-synthetic.json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string; plan: { scopeConfirmed: boolean } };
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.plan.scopeConfirmed, true);
});
