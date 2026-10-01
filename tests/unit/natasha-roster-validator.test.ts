import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  natashaRosterSnapshotSchema,
  validateNatashaRoster,
  type NatashaRosterSnapshot,
} from '../../src/lib/natasha-roster-validator';

function shift(
  id: string,
  employeeId: string,
  date: string,
  startTime = '09:00',
  endTime = '17:00',
  slot: 'opening' | 'closing' | 'intermediate' | 'single' = 'single',
  unitId = 'tirirical',
): NatashaRosterSnapshot['shifts'][number] {
  return { id, employeeId, unitId, date, startTime, endTime, slot };
}

function snapshot(changes: Partial<NatashaRosterSnapshot> = {}): NatashaRosterSnapshot {
  return {
    period: '2026-10',
    history: { from: '2026-09-15', through: '2026-09-30', complete: true },
    shifts: ['02', '09', '16', '23', '30'].map((day) => shift(`matrix-${day}`, 'leader', `2026-10-${day}`, '09:00', '17:00', 'single', 'matriz')),
    dayOffs: [],
    vacations: [],
    unavailabilities: [],
    fixedAssignments: [],
    fridayMatrix: { employeeId: 'leader', unitId: 'matriz', basis: 'role_holder' },
    ...changes,
  };
}

function codes(input: NatashaRosterSnapshot): string[] {
  return validateNatashaRoster(input).issues.map((issue) => issue.code);
}

test('confere snapshot sintético completo, sem prometer cobertura da operação', () => {
  const report = validateNatashaRoster(snapshot());
  assert.equal(report.status, 'checked');
  assert.equal(report.scope, 'rules_and_monthly_conditions_without_coverage');
  assert.deepEqual(report.issues, []);
});

test('bloqueia certificação sem histórico e sem decisão sobre a sexta na matriz', () => {
  const report = validateNatashaRoster(snapshot({ history: null, fridayMatrix: null, shifts: [] }));
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.issues.map((issue) => issue.code), [
    'FRIDAY_MATRIX_POLICY_UNCONFIRMED', 'HISTORY_INCOMPLETE',
  ]);
});

test('detecta dez horas entre fechamento e abertura e reporta também a preferência', () => {
  const input = snapshot();
  input.shifts.push(
    shift('sabado', 'samila', '2026-10-03', '14:00', '22:00', 'closing'),
    shift('domingo', 'samila', '2026-10-04', '08:00', '15:00', 'opening'),
  );
  assert.deepEqual(codes(input).filter((code) => code !== 'SLOT_CLASSIFICATION_MISSING'), [
    'REST_UNDER_11_HOURS', 'OPENING_AFTER_CLOSING',
  ]);
});

test('21h para 09h são doze horas: sem violação de interjornada, mas com preferência quebrada', () => {
  const input = snapshot();
  input.shifts.push(
    shift('fechamento', 'sara', '2026-10-03', '14:45', '21:00', 'closing', 'shopping'),
    shift('abertura', 'sara', '2026-10-04', '09:00', '15:15', 'opening', 'tirirical'),
  );
  assert.deepEqual(codes(input), ['OPENING_AFTER_CLOSING']);
  assert.equal(validateNatashaRoster(input).status, 'checked');
});

test('detecta sétimo dia de trabalho atravessando setembro e outubro', () => {
  const input = snapshot();
  ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    .forEach((date, index) => input.shifts.push(shift(`streak-${index}`, 'sara', date)));
  assert.ok(codes(input).includes('SEVENTH_CONSECUTIVE_DAY'));
  assert.equal(validateNatashaRoster(input).issues.find((issue) => issue.code === 'SEVENTH_CONSECUTIVE_DAY')?.date, '2026-10-04');
});

test('detecta terceiro domingo seguido atravessando a competência', () => {
  const input = snapshot();
  ['2026-09-20', '2026-09-27', '2026-10-04']
    .forEach((date, index) => input.shifts.push(shift(`sunday-${index}`, 'sara', date)));
  assert.ok(codes(input).includes('THIRD_CONSECUTIVE_SUNDAY'));
  assert.equal(validateNatashaRoster(input).issues.find((issue) => issue.code === 'THIRD_CONSECUTIVE_SUNDAY')?.date, '2026-10-04');
});

test('aplica somente férias de gozo aprovadas, inclusive quando atravessam o mês', () => {
  const input = snapshot();
  input.shifts.push(shift('vacation-work', 'edna', '2026-10-02'));
  input.vacations.push(
    { employeeId: 'edna', startDate: '2026-09-29', endDate: '2026-10-05', recordType: 'gozo', status: 'approved' },
    { employeeId: 'edna', startDate: '2026-10-01', endDate: '2026-10-05', recordType: 'gozo', status: 'rejected' },
  );
  assert.equal(codes(input).filter((code) => code === 'APPROVED_VACATION').length, 1);
});

test('rejeita sobreposição entre unidades, folga e indisponibilidade', () => {
  const input = snapshot();
  input.shifts.push(
    shift('first', 'sara', '2026-10-06', '09:00', '15:00', 'opening'),
    shift('second', 'sara', '2026-10-06', '14:00', '20:00', 'closing', 'shopping'),
  );
  input.dayOffs.push({ employeeId: 'sara', date: '2026-10-06' });
  input.unavailabilities.push({ employeeId: 'sara', startDate: '2026-10-06', endDate: '2026-10-07' });
  assert.ok(codes(input).includes('OVERLAPPING_SHIFTS'));
  assert.equal(codes(input).filter((code) => code === 'WORK_ON_DAY_OFF').length, 2);
  assert.equal(codes(input).filter((code) => code === 'UNAVAILABLE').length, 2);
});

test('confere datas fixas do mês e todas as sextas na matriz', () => {
  const input = snapshot();
  input.shifts = input.shifts.filter((item) => item.date !== '2026-10-02');
  input.fixedAssignments.push({ employeeId: 'carliane', unitId: 'tirirical', date: '2026-10-04' });
  assert.deepEqual(codes(input), ['FRIDAY_MATRIX_MISSING', 'FIXED_ASSIGNMENT_MISSING']);
});

test('não interpreta data inválida ou turno repetido como escala revisável', () => {
  const input = snapshot();
  input.shifts.push(shift('duplicate', 'sara', '2026-10-31'));
  input.shifts.push(shift('duplicate', 'sara', '2026-10-31'));
  assert.equal(natashaRosterSnapshotSchema.safeParse(input).success, false);
  const invalid = snapshot();
  invalid.shifts.push(shift('impossible', 'sara', '2026-10-32'));
  assert.equal(natashaRosterSnapshotSchema.safeParse(invalid).success, false);
});

test('entrega a continuidade do fim do mês para a revisão de novembro', () => {
  const input = snapshot();
  input.shifts.push(
    shift('oct-30', 'sara', '2026-10-30'),
    shift('oct-31', 'sara', '2026-10-31'),
  );
  assert.deepEqual(validateNatashaRoster(input).carryover.find((item) => item.employeeId === 'sara'), {
    employeeId: 'sara', endingWorkdayStreak: 2, endingSundayStreak: 0,
  });
});

test('comando de CLI lê fixture sintética sem escrever e devolve status verificável', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-validate.mts',
    '--input', 'tests/fixtures/natasha-roster-synthetic.json',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string; period: string };
  assert.equal(report.status, 'checked');
  assert.equal(report.period, '2026-10');
});
