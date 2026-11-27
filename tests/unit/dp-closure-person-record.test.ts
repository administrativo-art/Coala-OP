import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertsByPerson, applyAutomaticAbsences, automaticAbsenceDates, closureDayRow, closureMonthEnded, closureRecordHours, closureRecordIndicators,
  closureTrailProblemDays, firstPersonToOpen, type ClosureDayRow,
} from '../../src/features/dp/time-adjustments/closure-person-record-model';
import type { DayView } from '../../src/features/dp/rep-p/day-model';
import type { AdjustmentView } from '../../src/features/dp/time-adjustments/types';

const today = '2026-11-25';
const work = { type: 'work', startTime: '10:00', endTime: '16:15' };
const day = (date: string, extra: Record<string, unknown> = {}) => ({ date, shift: work, markings: [], allMarkings: [], absence: null, incidents: [],
  workedMinutes: 0, breakMinutes: null, plannedWorkMinutes: 360, nightMinutes: 0, balanceMinutes: null, deviation: null, ...extra }) as unknown as DayView;
const absence = (id: string, status: string) => ({ id, typeName: 'Atestado', status, startDate: '2026-11-10', endDate: '2026-11-10' });
const row = (value: DayView, input: Partial<Parameters<typeof closureDayRow>[1]> = {}) =>
  closureDayRow(value, { today, adjustments: [], automaticDates: new Set(), alerts: null, ...input });

test('sem resposta do servidor o dia grave é alerta, mas a tela não afirma que trava', () => {
  const result = row(day('2026-11-20', { incidents: ['short_break'] }));
  assert.equal(result.kind, 'alert');
  assert.equal(result.blocks, false);
});

test('com resposta do servidor só trava o que ele aponta; o cálculo mais rígido da tela vira aviso', () => {
  const incidents = { incidents: ['short_break'] };
  assert.equal(row(day('2026-11-20', incidents), { alerts: [] }).kind, 'warning');
  const blocking = row(day('2026-11-20', incidents), { alerts: [{ date: '2026-11-20', released: false }] });
  assert.deepEqual([blocking.kind, blocking.blocks, blocking.released], ['alert', true, false]);
  const released = row(day('2026-11-20', incidents), { alerts: [{ date: '2026-11-20', released: true }] });
  assert.deepEqual([released.kind, released.blocks, released.released], ['alert', false, true]);
});

test('pedido sem decisão vem antes da falta automática e do alerta; hoje e futuro não são tratados', () => {
  const adjustment = { workDate: '2026-11-16', status: 'in_review' } as AdjustmentView;
  assert.equal(row(day('2026-11-16', { incidents: ['odd'] }), { adjustments: [adjustment] }).kind, 'request');
  assert.equal(row(day('2026-11-10', { absence: absence('a', 'in_review') })).kind, 'request');
  assert.equal(row(day('2026-11-10', { absence: absence('b', 'approved') })).kind, 'absence');
  assert.equal(row(day(today, { incidents: ['odd'] })).kind, 'today');
  assert.equal(row(day('2026-11-26', { incidents: ['missing'] })).needsTreatment, false);
  assert.equal(row(day('2026-11-22', { shift: { type: 'day_off' } })).kind, 'day_off');
  assert.equal(row(day('2026-11-12', { incidents: ['late_exit'] })).kind, 'warning');
});

const rows: ClosureDayRow[] = [
  row(day('2026-11-03', { workedMinutes: 362 })),
  row(day('2026-11-04'), { automaticDates: new Set(['2026-11-04']) }),
  row(day('2026-11-07', { incidents: ['odd'], workedMinutes: 185 })),
  row(day('2026-11-13', { incidents: ['late_exit'], workedMinutes: 389 })),
  row(day(today, { workedMinutes: 183 })),
  row(day('2026-11-30')),
];

test('indicadores contam só dias passados e pedidos sem decisão; falta automática não conta como ausência aprovada', () => {
  const person = {
    adjustments: [{ status: 'in_review' }, { status: 'approved' }],
    absences: [{ id: 'auto', status: 'approved', automatic: true, startDate: '2026-11-04' }, { id: 'b', status: 'approved', startDate: '2026-11-10' }, { id: 'c', status: 'submitted' }],
    shiftSwaps: [{ status: 'pending' }],
  } as never;
  assert.deepEqual([...automaticAbsenceDates(person)], ['2026-11-04']);
  const result = closureRecordIndicators(rows, person);
  assert.deepEqual(
    [result.scheduledDays, result.clearDays, result.alertDays, result.blockingDays, result.warningDays, result.automaticAbsences, result.openRequests, result.approvedAbsences, result.toTreat],
    [4, 1, 1, 0, 1, 1, 3, 1, 2]);
});

test('horas do mês usam só lançamentos da competência; sem extrato os valores do banco ficam vazios', () => {
  const lines = [
    { competence: '2026-11', line: { nature: 'bank_credit', minutes: 40 } },
    { competence: '2026-11', line: { nature: 'bank_debit', minutes: 73 } },
    { competence: '2026-11', line: { nature: 'payroll_overtime', minutes: 50 } },
    { competence: '2026-10', line: { nature: 'bank_credit', minutes: 500 } },
  ] as never;
  assert.deepEqual(closureRecordHours(rows, lines, '2026-11'),
    { plannedMinutes: 1440, workedMinutes: 936, nightMinutes: 0, automaticAbsenceMinutes: 360, payrollOvertimeMinutes: 50, bankBalanceMinutes: -33 });
  const empty = closureRecordHours(rows, null, '2026-11');
  assert.deepEqual([empty.payrollOvertimeMinutes, empty.bankBalanceMinutes], [null, null]);
});

test('abre a primeira pessoa com algo a tratar; sem ninguém, a primeira da lista', () => {
  const clear = { requests: 0, alerts: 0, automaticAbsences: 0 };
  // Falta automática não é pendência: não puxa a abertura; pedido e alerta que trava puxam.
  assert.equal(firstPersonToOpen([{ uid: 'a', flags: { ...clear, automaticAbsences: 2 } }, { uid: 'b', flags: { ...clear, alerts: 1 } }]), 'b');
  assert.equal(firstPersonToOpen([{ uid: 'a', flags: { ...clear, automaticAbsences: 2 } }, { uid: 'b', flags: { ...clear, requests: 1 } }]), 'b');
  assert.equal(firstPersonToOpen([{ uid: 'a', flags: { ...clear, alerts: null } }, { uid: 'b', flags: { ...clear, alerts: null } }]), 'a');
  assert.equal(firstPersonToOpen([]), null);
});

test('alerta fora do escopo de quem consulta deixa todos sem contagem do servidor', () => {
  const alerts = [{ employeeUid: 'a', date: '2026-10-07', decision: null }, { employeeUid: 'a', date: '2026-10-20', decision: { by: 'x' } }];
  assert.deepEqual(alertsByPerson({ alerts, pendingOutsideScope: 0 })('a'), [{ date: '2026-10-07', released: false }, { date: '2026-10-20', released: true }]);
  assert.deepEqual(alertsByPerson({ alerts, pendingOutsideScope: 0 })('b'), []);
  assert.equal(alertsByPerson({ alerts, pendingOutsideScope: 1 })('a'), null);
  assert.equal(alertsByPerson(null)('a'), null);
});

// Forma real dos dois dados: o dia do colaborador chega sem a falta (`absence: null`, alerta "missing"); a declaração traz a data.
test('falta automática é cruzada pela data: não vira "dia sem batidas" nem entra na fila ou segura a etapa', () => {
  const dates = new Set(['2026-11-04']);
  const [applied, other, punched] = applyAutomaticAbsences([
    day('2026-11-04', { incidents: ['missing'] }), day('2026-11-05', { incidents: ['missing'] }),
    day('2026-11-04', { incidents: ['odd'], markings: [{ receiptId: 'r' }] }),
  ], dates);
  assert.deepEqual([applied.incidents, other.incidents, punched.incidents], [[], ['missing'], ['odd']]);
  const result = row(applied, { automaticDates: dates, alerts: [] });
  assert.deepEqual([result.kind, result.needsTreatment], ['automatic_absence', false]);
  assert.equal(closureTrailProblemDays([result]), 0);
});

test('a etapa de saneamento segue o servidor: aviso e liberado pelo RH não seguram; alerta que trava segura', () => {
  const incidents = { incidents: ['short_break'] };
  const warning = row(day('2026-11-20', incidents), { alerts: [] });
  const released = row(day('2026-11-20', incidents), { alerts: [{ date: '2026-11-20', released: true }] });
  const blocking = row(day('2026-11-20', incidents), { alerts: [{ date: '2026-11-20', released: false }] });
  assert.equal(closureTrailProblemDays([warning, released]), 0);
  assert.equal(released.needsTreatment, false);
  assert.equal(closureTrailProblemDays([warning, released, blocking]), 1);
  assert.equal(closureTrailProblemDays([row(day('2026-11-20', incidents))]), 1);
});

test('mês terminado segue o fuso e a margem de um dia do servidor', () => {
  assert.equal(closureMonthEnded('2026-11', new Date('2026-12-01T15:00:00Z')), false);
  assert.equal(closureMonthEnded('2026-11', new Date('2026-12-02T15:00:00Z')), true);
});

test('turno que atravessa a meia-noite sem alerta nunca é "sem ocorrência"; conta para conferir e fica fora da etapa', () => {
  const night = { shift: { type: 'work', startTime: '22:00', endTime: '06:00', overnight: true } };
  for (const alerts of [null, []]) assert.equal(row(day('2026-11-20', night), { alerts }).kind, 'overnight');
  const result = row(day('2026-11-20', night), { alerts: [] });
  const person = { adjustments: [], absences: [], shiftSwaps: [] };
  const indicators = closureRecordIndicators([result], person);
  assert.deepEqual([indicators.clearDays, indicators.withoutOccurrence, indicators.warningDays], [0, 0, 1]);
  assert.equal(closureTrailProblemDays([result]), 0);
  assert.equal(row(day('2026-11-20', { ...night, absence: absence('b', 'approved') })).kind, 'absence');
  assert.equal(row(day('2026-11-20', night), { alerts: [{ date: '2026-11-20', released: false }] }).kind, 'alert');
});

test('dia com falta automática não mostra saldo, como o servidor em dia com ausência', () => {
  const [applied] = applyAutomaticAbsences([day('2026-11-04', { incidents: ['missing'], balanceMinutes: -360 })], new Set(['2026-11-04']));
  assert.equal(applied.balanceMinutes, null);
});
