import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { natashaCoveragePlanSchema } from '../../src/lib/natasha-roster-coverage';
import { natashaProposalInputsSchema, assessNatashaProposalInputs } from '../../src/lib/natasha-proposal-preflight';
import { natashaRosterSnapshotSchema } from '../../src/lib/natasha-roster-validator';

function fixtures() {
  const snapshot = natashaRosterSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-history-synthetic.json', 'utf8')) as unknown);
  const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-coverage-synthetic.json', 'utf8')) as unknown);
  const inputs = natashaProposalInputsSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-proposal-inputs-synthetic.json', 'utf8')) as unknown);
  return { snapshot, plan, inputs };
}

test('pré-voo libera apenas a entrada sintética completa para o calculador local', () => {
  const { snapshot, plan, inputs } = fixtures();
  const result = assessNatashaProposalInputs(snapshot, plan, inputs);
  assert.equal(result.status, 'ready_for_solver');
  assert.equal(result.scope, 'input_readiness_only');
  assert.equal(result.positions, 5);
  assert.deepEqual(result.issues, []);
});

test('pergunta pela regra de sexta, histórico e confirmações ainda ausentes', () => {
  const { snapshot, plan, inputs } = fixtures();
  snapshot.fridayMatrix = null;
  snapshot.history!.complete = false;
  inputs.confirmed.vacations = false;
  inputs.confirmed.nextMonthCommitments = false;
  const result = assessNatashaProposalInputs(snapshot, plan, inputs);
  assert.equal(result.status, 'questions_pending');
  assert.ok(result.issues.some((issue) => issue.code === 'FRIDAY_MATRIX_POLICY'));
  assert.ok(result.issues.some((issue) => issue.code === 'HISTORY_INCOMPLETE'));
  assert.ok(result.issues.some((issue) => issue.code === 'CONFIRM_VACATIONS'));
  assert.ok(result.issues.some((issue) => issue.code === 'CONFIRM_NEXTMONTHCOMMITMENTS'));
});

test('férias aprovadas removem candidato de cada posição atingida', () => {
  const { snapshot, plan, inputs } = fixtures();
  snapshot.vacations.push({ employeeId: 'leader', startDate: '2026-10-02', endDate: '2026-10-02', recordType: 'gozo', status: 'approved' });
  const result = assessNatashaProposalInputs(snapshot, plan, inputs);
  assert.equal(result.status, 'infeasible');
  assert.ok(result.issues.some((issue) => issue.code === 'POSITION_WITHOUT_CANDIDATE' && issue.date === '2026-10-02'));
  assert.ok(result.issues.some((issue) => issue.code === 'FRIDAY_MATRIX_WITHOUT_POSITION' && issue.date === '2026-10-02'));
});

test('posição retirada deixa demanda e sexta impossíveis de cumprir', () => {
  const { snapshot, plan, inputs } = fixtures();
  inputs.positions.splice(0, 1);
  const result = assessNatashaProposalInputs(snapshot, plan, inputs);
  assert.equal(result.status, 'infeasible');
  assert.ok(result.issues.some((issue) => issue.code === 'POSITIONS_DO_NOT_COVER_DEMAND' && issue.date === '2026-10-02'));
  assert.ok(result.issues.some((issue) => issue.code === 'FRIDAY_MATRIX_WITHOUT_POSITION' && issue.date === '2026-10-02'));
});

test('data fixa sem posição elegível não é tratada como preferência', () => {
  const { snapshot, plan, inputs } = fixtures();
  snapshot.fixedAssignments.push({ employeeId: 'leader', unitId: 'matriz', date: '2026-10-05' });
  const result = assessNatashaProposalInputs(snapshot, plan, inputs);
  assert.equal(result.status, 'infeasible');
  assert.ok(result.issues.some((issue) => issue.code === 'FIXED_ASSIGNMENT_WITHOUT_POSITION'));
});

test('turnos do mês alvo ou compromisso posterior fora da janela não passam como entrada limpa', () => {
  const { snapshot, plan, inputs } = fixtures();
  snapshot.shifts.push({ id: 'existing', employeeId: 'leader', unitId: 'matriz', date: '2026-10-02', startTime: '09:00', endTime: '17:00' });
  inputs.nextMonthKnownShifts.push({ employeeId: 'leader', unitId: 'matriz', date: '2026-11-15', startTime: '09:00', endTime: '17:00' });
  const result = assessNatashaProposalInputs(snapshot, plan, inputs);
  assert.equal(result.status, 'questions_pending');
  assert.ok(result.issues.some((issue) => issue.code === 'TARGET_SHIFTS_PRESENT'));
  assert.ok(result.issues.some((issue) => issue.code === 'NEXT_MONTH_SHIFT_OUTSIDE_WINDOW'));
});

test('CLI de pré-voo usa somente os três arquivos sintéticos', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-preflight.mts',
    '--snapshot', 'tests/fixtures/natasha-history-synthetic.json',
    '--plan', 'tests/fixtures/natasha-coverage-synthetic.json',
    '--inputs', 'tests/fixtures/natasha-proposal-inputs-synthetic.json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((JSON.parse(result.stdout) as { status: string }).status, 'ready_for_solver');
});
