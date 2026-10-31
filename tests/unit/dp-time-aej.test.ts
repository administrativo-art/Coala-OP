import assert from 'node:assert/strict';
import test from 'node:test';

import { aejShiftOf, aejText, generateAej, type AejInput } from '../../src/features/dp/time-adjustments/aej';

const shift = { date: '2026-08-12', startTime: '08:00', endTime: '16:00', overnight: false, netMinutes: 420, breaks: [{ start: '12:00', end: '13:00' }] };
const input = (): AejInput => ({
  employer: { cnpj: '14.276.603/0001-25', legalName: 'Empregador | do ensaio', caepf: null, cno: null },
  startDate: '2026-08-01', endDate: '2026-08-31', generatedAt: '2026-10-17T09:00:00-0300', rep: { inpiRegistration: '512026000001' },
  ptrp: { name: 'Coala One - Tratamento de Ponto', version: '1.0.0', developerCnpj: '14276603000125', developerName: 'CT SORVETES LTDA', developerEmail: 'dev@exemplo.com' },
  employees: [{ cpf: '52998224725', name: 'Maria Fiscal', shifts: [shift],
    markings: [
      { workDate: '2026-08-12', markedAt: '2026-08-12T08:02:00-0300', nsr: 10, discardReason: null },
      { workDate: '2026-08-12', markedAt: '2026-08-12T12:00:00-0300', nsr: 11, discardReason: null },
      { workDate: '2026-08-12', markedAt: '2026-08-12T12:01:00-0300', nsr: 12, discardReason: 'Batida duplicada' },
      { workDate: '2026-08-12', markedAt: '2026-08-12T13:00:00-0300', nsr: 13, discardReason: null },
    ],
    inclusions: [{ workDate: '2026-08-12', markedAt: '2026-08-12T16:00:00-0300', reason: 'Esqueci de bater a saída' }] }],
});

test('AEJ segue o leiaute 002: registros, ordem, E/S/D, origem, motivo, trailer e assinatura', () => {
  const pkg = generateAej(input());
  const text = pkg.bytes.toString('latin1');
  assert.ok(text.endsWith('\r\n'));
  assert.equal(text.includes('\n\n'), false);
  const lines = text.split('\r\n').slice(0, -1);
  assert.equal(lines[0], '01|1|14276603000125|||Empregador do ensaio|2026-08-01|2026-08-31|2026-10-17T09:00:00-0300|002');
  assert.equal(lines[1], '02|1|3|00000512026000001');
  assert.equal(lines[2], '03|1|52998224725|Maria Fiscal');
  assert.equal(lines[3], '04|HC001|420|0800|1200|1300|1600');
  assert.deepEqual(lines.slice(4, 9), [
    '05|1|2026-08-12T08:02:00-0300|1|E|001|O|HC001|',
    '05|1|2026-08-12T12:00:00-0300|1|S|001|O||',
    '05|1|2026-08-12T12:01:00-0300|1|D|000|O||Batida duplicada',
    '05|1|2026-08-12T13:00:00-0300|1|E|002|O||',
    '05|1|2026-08-12T16:00:00-0300||S|002|I||Esqueci de bater a saída',
  ]);
  assert.equal(lines[9], '08|Coala One - Tratamento de Ponto|1.0.0|1|14276603000125|CT SORVETES LTDA|dev@exemplo.com');
  assert.equal(lines[10], '99|1|1|1|1|5|0|0|1');
  assert.equal(lines[11], 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.padEnd(100, ' '));
  assert.equal(pkg.filename, 'AEJ_14276603000125_20260801_20260831.txt');
  assert.deepEqual(pkg.warnings, []);
  // Codificação ISO 8859-1: "ç" ocupa um byte.
  assert.ok(pkg.bytes.includes(Buffer.from('saída', 'latin1')));
});

test('AEJ mantém INPI ausente em branco, sem criar número fictício', () => {
  const data = input();
  data.rep.inpiRegistration = '';
  assert.equal(generateAej(data).bytes.toString('latin1').split('\r\n')[1], '02|1|3|');
});

test('AEJ avisa dia sem escala e batidas ímpares, sem inventar horário', () => {
  const data = input();
  data.employees[0].shifts = [];
  data.employees[0].inclusions = [];
  const pkg = generateAej(data);
  assert.deepEqual(pkg.warnings.map((item) => item.code).sort(), ['NO_SHIFT', 'ODD_MARKINGS']);
  assert.match(pkg.bytes.toString('latin1'), /05\|1\|2026-08-12T08:02:00-0300\|1\|E\|001\|O\|\|/);
  assert.equal(aejText('a|b\r\nc 😅', 150), 'a b c ?');
});

test('AEJ representa turno noturno e a saída após meia-noite no mesmo dia de jornada', () => {
  const data = input();
  data.employees[0].shifts = [{ date: '2026-08-12', startTime: '22:00', endTime: '05:00', overnight: true, netMinutes: 420, breaks: [] }];
  data.employees[0].markings = [
    { workDate: '2026-08-12', markedAt: '2026-08-12T22:00:00-0300', nsr: 10, discardReason: null },
    { workDate: '2026-08-12', markedAt: '2026-08-13T05:00:00-0300', nsr: 11, discardReason: null },
  ];
  data.employees[0].inclusions = [];
  const pkg = generateAej(data);
  assert.equal(pkg.warnings.some((item) => item.code === 'NIGHT_SHIFT'), false);
  assert.match(pkg.bytes.toString('latin1'), /04\|HC001\|420\|2200\|0500\|\|/);
  assert.match(pkg.bytes.toString('latin1'), /2026-08-13T05:00:00-0300\|1\|S\|001\|O/);
});

test('horário contratual do dia vem da escala: fixo vira pares; intervalo livre fica só início e fim', () => {
  const base = { date: '2026-08-12', type: 'work' as const, startTime: '08:00', endTime: '16:00', overnight: false, unitId: 'u', unitName: 'U', unitTimeZone: 'America/Fortaleza', shiftName: 'Manhã',
    breakStart: null, breakEnd: null, breakDurationMinutes: 60, breakWindowStart: null, breakWindowEnd: null, expectedPunches: null, executionUnitPolicy: 'scheduled' as const, locationTrackingPolicy: 'punch_only' as const,
    breakSegments: null, breakSplit: 'single' as const, breakPauseCount: null, breakMinPauseMinutes: null, toleranceMinutes: null, journeyId: null, referenceMinutes: null };
  assert.deepEqual(aejShiftOf({ ...base, breakType: 'fixed', breakStart: '12:00', breakEnd: '13:00' })!.breaks, [{ start: '12:00', end: '13:00' }]);
  const flexible = aejShiftOf({ ...base, breakType: 'flexible' })!;
  assert.deepEqual(flexible.breaks, []);
  assert.equal(flexible.netMinutes, 420);
  assert.equal(aejShiftOf({ ...base, type: 'day_off', breakType: 'none' }), null);
  assert.equal(aejShiftOf({ ...base, breakType: 'none', startTime: '22:00', endTime: '04:00' })!.overnight, true);
});

test('turnos com os mesmos horários e duração diferente ganham códigos distintos; motivo vazio é recusado', () => {
  const data = input();
  data.employees.push({ cpf: '11144477735', name: 'Ana', inclusions: [], markings: [{ workDate: '2026-08-13', markedAt: '2026-08-13T08:00:00-0300', nsr: 20, discardReason: null }],
    shifts: [{ ...shift, date: '2026-08-13', breaks: [], netMinutes: 450 }, { ...shift, date: '2026-08-14', breaks: [], netMinutes: 420 }] });
  const lines = generateAej(data).bytes.toString('latin1').split('\r\n').filter((line) => line.startsWith('04|'));
  assert.deepEqual(lines, ['04|HC001|420|0800|1200|1300|1600', '04|HC002|420|0800|1600||', '04|HC003|450|0800|1600||']);
  const bad = input();
  bad.employees[0].inclusions[0].reason = '   ';
  assert.throws(() => generateAej(bad), /AEJ_MOTIVO_MISSING/);
});

test('registro 07: DSR e movimentos do banco depois das marcações, contados no trailer; movimento sem minutos é recusado', () => {
  const data = input();
  data.employees[0].absences = [
    { date: '2026-08-13', kind: '3', minutes: 80, movement: '2' },
    { date: '2026-08-12', kind: '3', minutes: 15, movement: '1' },
    { date: '2026-08-10', kind: '1' },
    { date: '2026-09-01', kind: '1' },
  ];
  const lines = generateAej(data).bytes.toString('latin1').split('\r\n');
  assert.deepEqual(lines.slice(9, 12), ['07|1|1|2026-08-10||', '07|1|3|2026-08-12|15|1', '07|1|3|2026-08-13|80|2']);
  assert.match(lines[12], /^08\|/);
  assert.equal(lines[13], '99|1|1|1|1|5|0|3|1');
  data.employees[0].absences = [{ date: '2026-08-12', kind: '3', movement: '1' }];
  assert.throws(() => generateAej(data), /AEJ_BANK_MOVEMENT_INVALID/);
});
