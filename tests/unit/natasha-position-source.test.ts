import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { natashaPositionDecisionsSchema, prepareNatashaPositions } from '../../src/lib/natasha-position-source';
import { natashaCoveragePlanSchema } from '../../src/lib/natasha-roster-coverage';
import { natashaShiftDirectoryReportSchema } from '../../src/lib/natasha-shift-directory';

function inputs() {
  return {
    plan: natashaCoveragePlanSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-coverage-synthetic.json', 'utf8')) as unknown),
    shifts: natashaShiftDirectoryReportSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-shift-definitions-synthetic.json', 'utf8')) as unknown),
    decisions: natashaPositionDecisionsSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-position-decisions-synthetic.json', 'utf8')) as unknown),
  };
}

test('expande padrão confirmado em posições que cobrem todas as sextas abertas', () => {
  const { plan, shifts, decisions } = inputs();
  const report = prepareNatashaPositions(plan, shifts, decisions);
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.positions.length, 5);
  assert.deepEqual(report.positions.map((item) => item.date), [
    '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30',
  ]);
  assert.ok(report.positions.every((item) => item.slot === 'single' && item.requiredRoleId === 'lider'));
  assert.equal(report.evidence.inferredSlotClassifications, 0);
  assert.ok(report.trace.every((item) => item.shiftDefinitionId === 'sexta-integral' && item.override === false));
});

test('confirmações ausentes impedem prontidão mesmo quando os horários cobrem a demanda', () => {
  const { plan, shifts, decisions } = inputs();
  decisions.confirmed.slotClassifications = false;
  const report = prepareNatashaPositions(plan, shifts, decisions);
  assert.equal(report.status, 'questions_pending');
  assert.ok(report.issues.some((item) => item.code === 'CONFIRM_SLOT_CLASSIFICATIONS'));
});

test('quantidade ou horário insuficiente produz lacuna segmentada, não uma falsa posição pronta', () => {
  const { plan, shifts, decisions } = inputs();
  plan.units[0].days[1] = { date: '2026-10-02', status: 'open', windows: [{ startTime: '09:00', endTime: '17:00', minimumPeople: 2 }] };
  const report = prepareNatashaPositions(plan, shifts, decisions);
  assert.equal(report.status, 'coverage_gaps');
  assert.ok(report.issues.some((item) => item.code === 'POSITIONS_DO_NOT_COVER_DEMAND'
    && item.date === '2026-10-02' && item.requiredPeople === 2 && item.scheduledPeople === 1));
});

test('exceção explícita substitui o padrão e mantém rastreabilidade do horário especial', () => {
  const { plan, shifts, decisions } = inputs();
  decisions.dateOverrides.push({
    unitId: 'matriz', date: '2026-10-09', reason: 'Reforço sintético confirmado',
    positions: [
      { source: 'custom', key: 'especial', startTime: '09:00', endTime: '17:00', slot: 'single', count: 1, requiredRoleId: 'lider' },
      { source: 'custom', key: 'reforco', startTime: '12:00', endTime: '16:00', slot: 'intermediate', count: 1, requiredRoleId: null },
    ],
  });
  const report = prepareNatashaPositions(plan, shifts, decisions);
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.positions.filter((item) => item.date === '2026-10-09').length, 2);
  assert.ok(report.trace.some((item) => item.decisionKey === 'reforco' && item.source === 'custom' && item.override));
});

test('intervalo intrajornada não suportado bloqueia o uso silencioso da definição', () => {
  const { plan, shifts, decisions } = inputs();
  shifts.shiftDefinitions[0].breakStart = '12:00';
  shifts.shiftDefinitions[0].breakEnd = '13:00';
  const report = prepareNatashaPositions(plan, shifts, decisions);
  assert.equal(report.status, 'questions_pending');
  assert.equal(report.positions.length, 0);
  assert.ok(report.issues.some((item) => item.code === 'SHIFT_HAS_BREAK_UNSUPPORTED'));
});

test('posição especial em dia fechado é tratada como conflito de fonte', () => {
  const { plan, shifts, decisions } = inputs();
  decisions.dateOverrides.push({
    unitId: 'matriz', date: '2026-10-01', reason: 'Teste de conflito',
    positions: [{ source: 'custom', key: 'indevida', startTime: '09:00', endTime: '17:00', slot: 'single', count: 1, requiredRoleId: null }],
  });
  const report = prepareNatashaPositions(plan, shifts, decisions);
  assert.equal(report.status, 'questions_pending');
  assert.ok(report.issues.some((item) => item.code === 'POSITIONS_ON_CLOSED_DAY' && item.date === '2026-10-01'));
});

test('CLI prepara posições usando somente arquivos sintéticos', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-prepare-positions.mts',
    '--plan', 'tests/fixtures/natasha-coverage-synthetic.json',
    '--shifts', 'tests/fixtures/natasha-shift-definitions-synthetic.json',
    '--decisions', 'tests/fixtures/natasha-position-decisions-synthetic.json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string; positions: unknown[] };
  assert.equal(report.status, 'ready_for_preflight');
  assert.equal(report.positions.length, 5);
});
