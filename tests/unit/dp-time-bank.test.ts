import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyWeeklyOvertimeLimits, bankLinesWithMovements, buildStatement, categoryFor, computeBankDay, journeyReferenceMinutes, monthTotals, overnightWorkDate,
  type BankDayInput, type BankPolicy, type BankShift } from '../../src/features/dp/time-bank/core';
import { cycleLabel, cycleOf, presetOf } from '../../src/features/dp/time-bank/cycle';
import type { DPOvertimeCategory } from '../../src/types';

const categories: DPOvertimeCategory[] = [
  { id: 'banco', name: 'Banco', trigger: 'workday', ratePercent: 50, destination: 'time_bank', bankCreditFactor: 1.5, requiresApproval: false },
  { id: 'folga', name: 'Folga', trigger: 'rest_day', ratePercent: 100, destination: 'payroll', requiresApproval: false },
  { id: 'domingo', name: 'Domingo', trigger: 'sunday', ratePercent: 100, destination: 'payroll', requiresApproval: false },
  { id: 'feriado', name: 'Feriado', trigger: 'holiday', ratePercent: 100, destination: 'payroll', requiresApproval: false },
];
const policy: BankPolicy = { id: 'p', version: 1, categories, dailyOvertimeLimitMinutes: undefined,
  timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review' } };
// Turno 10:00–16:15 com 15 min de intervalo = 6h líquidas; jornada de 7h20.
const shift: BankShift = { type: 'work', startTime: '10:00', endTime: '16:15', overnight: false, plannedMinutes: 360, referenceMinutes: 440, toleranceMinutes: 5, journeyId: 'j' };
const at = (date: string, time: string) => `${date}T${time}:00-0300`;
const day = (input: Partial<BankDayInput> & { markings?: string[] }): BankDayInput =>
  ({ date: '2026-10-14', shift, markings: [], absences: [], holiday: false, policy, ...input });
const punches = (date: string, ...times: string[]) => times.map((time) => at(date, time));

describe('Banco de horas: apuração do dia', () => {
  it('jornada de 7h20 com turno de 6h cumprido vira −1h20 no banco', () => {
    const result = computeBankDay(day({ markings: punches('2026-10-14', '10:00', '13:00', '13:15', '16:15') }));
    assert.equal(result.consideredMinutes, 360);
    assert.equal(result.deltaMinutes, -80);
    assert.deepEqual(result.lines, [{ nature: 'bank_debit', minutes: 80, reason: 'worked_less' }]);
  });

  it('tolerância: até 5 min por marcação e a da jornada somadas; acima, conta tudo', () => {
    const equal = { ...shift, referenceMinutes: 360 };
    const inside = computeBankDay(day({ shift: equal, markings: punches('2026-10-14', '10:03', '13:00', '13:15', '16:15') }));
    assert.equal(inside.toleranceApplied, true);
    assert.deepEqual(inside.lines, []);
    const above = computeBankDay(day({ shift: equal, markings: punches('2026-10-14', '10:06', '13:00', '13:15', '16:15') }));
    assert.deepEqual(above.lines, [{ nature: 'bank_debit', minutes: 6, reason: 'worked_less' }]);
    // 4 min de atraso e 4 min de saída antecipada: cada um ≤ 5, mas a soma passa da tolerância de 5.
    const sum = computeBankDay(day({ shift: equal, markings: punches('2026-10-14', '10:04', '13:00', '13:15', '16:11') }));
    assert.deepEqual(sum.lines, [{ nature: 'bank_debit', minutes: 8, reason: 'worked_less' }]);
    // Intervalo reduzido não herda a tolerância.
    const shortBreak = computeBankDay(day({ shift: equal, markings: punches('2026-10-14', '10:00', '13:00', '13:10', '16:15') }));
    assert.equal(shortBreak.deltaMinutes, 5);
  });

  it('antes da automação, dia sem batida fica a tratar; a ausência registrada decide abono, folha ou banco', () => {
    const missing = computeBankDay(day({}));
    assert.deepEqual([missing.lines, missing.issues, missing.unjustifiedAbsence], [[{ nature: 'review', minutes: 440, reason: 'missing_day' }], ['MISSING_DAY'], false]);
    // Sem batida e com 2h de ausência injustificada: as 2h vão à folha e o resto fica a tratar, sem débito no banco.
    const partial = computeBankDay(day({ absences: [{ id: 'h', typeName: 'Atraso', unit: 'hour', startDate: '2026-10-14', endDate: '2026-10-14', minutes: 120, effect: 'unexcused_absence' }] }));
    assert.deepEqual([partial.lines, partial.issues], [[{ nature: 'payroll_discount', minutes: 120, reason: 'absence_unexcused' }, { nature: 'review', minutes: 320, reason: 'missing_day' }], ['MISSING_DAY']]);
    const absence = { id: 'a', typeName: 'Atestado', unit: 'day' as const, startDate: '2026-10-14', endDate: '2026-10-14', minutes: null };
    const excused = computeBankDay(day({ absences: [{ ...absence, effect: 'excused_absence' }] }));
    assert.deepEqual([excused.lines, excused.abonoMinutes], [[], 440]);
    const unexcused = computeBankDay(day({ absences: [{ ...absence, effect: 'unexcused_absence' }] }));
    assert.deepEqual([unexcused.lines, unexcused.unjustifiedAbsence, unexcused.absences], [[{ nature: 'payroll_discount', minutes: 440, reason: 'absence_unexcused' }], true, [{ id: 'a', effect: 'unexcused_absence' }]]);
    const bankDebit = computeBankDay(day({ absences: [{ ...absence, effect: 'time_bank_debit' }] }));
    assert.deepEqual([bankDebit.lines, bankDebit.unjustifiedAbsence], [[{ nature: 'bank_debit', minutes: 440, reason: 'absence_debit' }], false]);
    // Injustificada em horas: desconto na folha das horas, e o banco só vê o resto.
    assert.deepEqual(computeBankDay(day({ shift: { ...shift, referenceMinutes: 360 }, markings: punches('2026-10-14', '12:00', '13:00', '13:15', '16:15'),
      absences: [{ ...absence, unit: 'hour', minutes: 120, effect: 'unexcused_absence' }] })).lines, [{ nature: 'payroll_discount', minutes: 120, reason: 'absence_unexcused' }]);
    // Ausência em horas abonada sem nenhuma batida: abona as horas e o resto fica a tratar.
    assert.deepEqual(computeBankDay(day({ absences: [{ ...absence, unit: 'hour', minutes: 120, effect: 'excused_absence' }] })).lines, [{ nature: 'review', minutes: 320, reason: 'missing_day' }]);
    assert.ok(computeBankDay(day({ absences: [{ ...absence, effect: 'manual_review' }] })).issues.includes('ABSENCE_REVIEW'));
    const hours = computeBankDay(day({ shift: { ...shift, referenceMinutes: 360 }, markings: punches('2026-10-14', '12:00', '13:00', '13:15', '16:15'),
      absences: [{ ...absence, unit: 'hour', minutes: 120, effect: 'excused_absence' }] }));
    assert.deepEqual([hours.deltaMinutes, hours.lines], [0, []]);
  });

  it('tempo a mais segue a faixa: banco com fator, limite diário vira revisão', () => {
    const more = computeBankDay(day({ shift: { ...shift, referenceMinutes: 360 }, markings: punches('2026-10-14', '10:00', '13:00', '13:15', '17:15') }));
    assert.deepEqual(more.lines, [{ nature: 'bank_credit', minutes: 90, reason: 'worked_more', factor: 1.5, categoryId: 'banco', ratePercent: 50 }]);
    const limited = computeBankDay(day({ shift: { ...shift, referenceMinutes: 360 }, policy: { ...policy, dailyOvertimeLimitMinutes: 30 },
      markings: punches('2026-10-14', '10:00', '13:00', '13:15', '17:15') }));
    assert.deepEqual(limited.lines.map((line) => [line.nature, line.minutes, line.reason]), [['bank_credit', 45, 'worked_more'], ['review', 30, 'daily_limit_exceeded']]);
  });

  it('trabalho na folga, no domingo e no feriado vai para a folha pela faixa da política', () => {
    const off: BankShift = { ...shift, type: 'day_off', referenceMinutes: null };
    const rest = computeBankDay(day({ shift: off, markings: punches('2026-10-14', '10:00', '14:00') }));
    assert.deepEqual(rest.lines, [{ nature: 'payroll_overtime', minutes: 240, reason: 'rest_day_work', categoryId: 'folga', ratePercent: 100 }]);
    assert.equal(computeBankDay(day({ date: '2026-10-18', shift: off, markings: punches('2026-10-18', '10:00', '14:00') })).lines[0].categoryId, 'domingo');
    assert.equal(computeBankDay(day({ shift: off, holiday: true, markings: punches('2026-10-14', '10:00', '14:00') })).lines[0].categoryId, 'feriado');
    // Dia sem turno na escala oficial vai para revisão; faixa que pede aprovação também, sem entrar no saldo.
    assert.deepEqual(computeBankDay(day({ shift: null, markings: punches('2026-10-14', '10:00', '14:00') })).lines, [{ nature: 'review', minutes: 240, reason: 'unplanned_work' }]);
    const approval = { ...policy, categories: categories.map((item) => item.id === 'banco' ? { ...item, requiresApproval: true } : item) };
    assert.deepEqual(computeBankDay(day({ policy: approval, shift: { ...shift, referenceMinutes: 360 }, markings: punches('2026-10-14', '10:00', '13:00', '13:15', '17:15') })).lines,
      [{ nature: 'review', minutes: 60, reason: 'pending_approval', categoryId: 'banco', ratePercent: 50, requiresApproval: true }]);
    assert.equal(categoryFor(categories.filter((item) => item.trigger === 'workday'), { kind: 'rest_day', holiday: false, sunday: false, weekday: 3 }), null);
  });

  it('casos sem regra segura vão para revisão, sem lançamento', () => {
    assert.deepEqual(computeBankDay(day({ markings: punches('2026-10-14', '10:00', '13:00', '13:15') })).issues, ['ODD_MARKINGS']);
    assert.deepEqual(computeBankDay(day({ holiday: true, markings: punches('2026-10-14', '10:00', '16:15') })).lines, []);
    assert.ok(computeBankDay(day({ shift: { ...shift, referenceMinutes: null } })).issues.includes('NO_JOURNEY'));
    assert.ok(computeBankDay(day({ shift: { ...shift, referenceMinutes: 0 } })).issues.includes('NO_JOURNEY'));
    assert.ok(computeBankDay(day({ policy: null })).issues.includes('NO_POLICY'));
    const disabled = computeBankDay(day({ policy: { ...policy, timeBank: { ...policy.timeBank, enabled: false } }, markings: punches('2026-10-14', '10:00', '13:00', '13:15', '16:15') }));
    assert.deepEqual(disabled.lines, [{ nature: 'review', minutes: 80, reason: 'needs_review' }]);
  });

  it('pareia turno noturno pela virada do dia e preserva os minutos noturnos para a folha', () => {
    const nightShift: BankShift = { ...shift, startTime: '22:00', endTime: '05:00', overnight: true, plannedMinutes: 420, referenceMinutes: 420 };
    const result = computeBankDay(day({ date: '2026-10-14', shift: nightShift,
      markings: ['2026-10-14T22:00:00-0300', '2026-10-15T05:00:00-0300'] }));
    assert.deepEqual([result.workedMinutes, result.nightMinutes, result.deltaMinutes, result.lines, result.issues], [420, 420, 0, [], ['NIGHT_SHIFT']]);
    assert.equal(overnightWorkDate('2026-10-15', '2026-10-15T05:00:00-0300', [{ date: '2026-10-14', overnight: true, endTime: '05:00' }]), '2026-10-14');
    const sameDay = computeBankDay(day({ date: '2026-10-14', shift: { ...shift, startTime: '18:00', endTime: '23:00', referenceMinutes: 300 },
      markings: punches('2026-10-14', '18:00', '23:00') }));
    assert.deepEqual([sameDay.nightMinutes, sameDay.issues], [60, ['NIGHT_SHIFT']]);
  });

  it('aplica o limite semanal sem perder a memória da parte admitida', () => {
    const weekly = { ...policy, weeklyOvertimeLimitMinutes: 90 };
    const make = (date: string) => computeBankDay(day({ date, policy: weekly, shift: { ...shift, referenceMinutes: 360 },
      markings: punches(date, '10:00', '13:00', '13:15', '17:15') }));
    const limited = applyWeeklyOvertimeLimits([make('2026-10-12'), make('2026-10-13')]);
    assert.deepEqual(limited.flatMap((item) => item.lines).map((line) => [line.nature, line.minutes, line.reason]), [
      ['bank_credit', 90, 'worked_more'], ['bank_credit', 45, 'worked_more'], ['review', 30, 'weekly_limit_exceeded'],
    ]);
  });

  it('reaplica o limite semanal na sequência consolidada quando a semana atravessa a competência', () => {
    const weekly = { ...policy, weeklyOvertimeLimitMinutes: 90 };
    const make = (date: string) => computeBankDay(day({ date, policy: weekly, shift: { ...shift, referenceMinutes: 360 },
      markings: punches(date, '10:00', '13:00', '13:15', '17:15') }));
    const september = applyWeeklyOvertimeLimits([make('2026-09-30')]);
    const october = applyWeeklyOvertimeLimits([make('2026-10-01')]);
    const lines = bankLinesWithMovements([
      { competence: '2026-09', closureVersion: 1, days: september, totals: monthTotals(september) },
      { competence: '2026-10', closureVersion: 1, days: october, totals: monthTotals(october) },
    ]);
    assert.deepEqual(lines.map((item) => [item.date, item.line.nature, item.line.minutes, item.line.reason]), [
      ['2026-09-30', 'bank_credit', 90, 'worked_more'],
      ['2026-10-01', 'bank_credit', 45, 'worked_more'],
      ['2026-10-01', 'review', 30, 'weekly_limit_exceeded'],
    ]);
  });

  it('referência da jornada pelo ciclo fixo ou pela carga única quando a folga vem da escala', () => {
    const journey = { cycleLengthDays: 7, validFrom: '2026-10-05', days: [1, 2, 3, 4, 5, 6, 7].map((dayIndex) => ({ dayIndex, plannedMinutes: dayIndex === 7 ? 0 : 440 })) };
    assert.equal(journeyReferenceMinutes(journey, '2026-10-05'), 440);
    assert.equal(journeyReferenceMinutes(journey, '2026-10-11'), 0);
    assert.equal(journeyReferenceMinutes(journey, '2026-10-04'), null);
    assert.equal(journeyReferenceMinutes({ ...journey, weeklyRest: { placement: 'schedule' } }, '2026-10-11'), 440);
  });
});

describe('Banco de horas: ciclo e extrato', () => {
  it('ciclo em dias e em meses a partir do marco; seis meses não são 180 dias', () => {
    assert.deepEqual(cycleOf({ unit: 'day', length: 15, anchorDate: '2026-10-01' }, '2026-10-20'), { index: 1, start: '2026-10-16', end: '2026-10-30' });
    assert.deepEqual(cycleOf({ unit: 'month', length: 1, anchorDate: '2026-01-01' }, '2026-10-20'), { index: 9, start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(cycleOf({ unit: 'month', length: 6, anchorDate: '2026-01-10' }, '2026-07-09'), { index: 0, start: '2026-01-10', end: '2026-07-09' });
    assert.equal(cycleOf({ unit: 'day', length: 180, anchorDate: '2026-01-10' }, '2026-07-09').start, '2026-07-09');
    assert.equal(presetOf({ unit: 'day', length: 15 }), 'fortnight');
    assert.equal(presetOf({ unit: 'day', length: 20 }), 'custom');
    assert.equal(cycleLabel({ unit: 'day', length: 20, anchorDate: '2026-10-01', residualDestination: 'carry' }), '20 dias a partir de 01/10/2026');
  });

  it('extrato soma o ciclo, transporta a abertura e mostra o residual quando o ciclo terminou', () => {
    const debit = computeBankDay(day({ date: '2026-10-14', markings: punches('2026-10-14', '10:00', '13:00', '13:15', '16:15') }));
    const outside = computeBankDay(day({ date: '2026-09-30' }));
    const months = [{ competence: '2026-10', closureVersion: 2, days: [debit], totals: monthTotals([debit]) }, { competence: '2026-09', closureVersion: 1, days: [outside], totals: monthTotals([outside]) }];
    const timeBank = { allowNegativeBalance: false, negativeLimitMinutes: 60, cycle: { unit: 'month' as const, length: 1, anchorDate: '2026-01-01', residualDestination: 'payroll' as const } };
    const open = buildStatement({ period: { start: '2026-10-01', end: '2026-10-31', index: 9 }, today: '2026-10-20', months, missing: ['2026-10'], openingMinutes: 30, timeBank });
    assert.deepEqual([open.credit, open.debit, open.balanceMinutes, open.ended, open.residual], [0, 80, -50, false, null]);
    assert.deepEqual(open.limits, { positiveExceeded: false, negativeExceeded: false, negativeNotAllowed: true });
    const ended = buildStatement({ period: { start: '2026-10-01', end: '2026-10-31', index: 9 }, today: '2026-11-05', months, missing: [], openingMinutes: 0, timeBank });
    assert.deepEqual(ended.residual, { minutes: -80, destination: 'payroll' });
    assert.equal(ended.limits.negativeExceeded, true);
    assert.equal(ended.lines.length, 1);
    // Zerar só perdoa saldo negativo; crédito vai para revisão.
    const credit = computeBankDay(day({ shift: { ...shift, referenceMinutes: 300 }, markings: punches('2026-10-14', '10:00', '13:00', '13:15', '16:15') }));
    const forfeit = buildStatement({ period: { start: '2026-10-01', end: '2026-10-31', index: 9 }, today: '2026-11-05', missing: [], openingMinutes: 0,
      months: [{ competence: '2026-10', closureVersion: 1, days: [credit], totals: monthTotals([credit]) }], timeBank: { ...timeBank, cycle: { ...timeBank.cycle, residualDestination: 'forfeit' } } });
    assert.deepEqual(forfeit.residual, { minutes: 90, destination: 'review' });
    const settlement = { uid: 'u', cycle: { start: '2026-10-01', end: '2026-10-31' }, minutes: -80, destination: 'payroll' as const, policy: { id: 'p', version: 1 }, closureVersions: { '2026-10': 1 }, settledBy: 'dp', settledAt: '2026-11-05T12:00:00Z' };
    const outdated = buildStatement({ period: { start: '2026-10-01', end: '2026-10-31', index: 9 }, today: '2026-11-06', months, missing: [], openingMinutes: 0, timeBank, settlement });
    assert.equal(outdated.settlementOutdated, true);
    assert.equal(buildStatement({ period: { start: '2026-10-01', end: '2026-10-31', index: 9 }, today: '2026-11-06', months, missing: [], openingMinutes: 0, timeBank, settlement: { ...settlement, closureVersions: { '2026-10': 2 } } }).settlementOutdated, false);
  });

  it('vence cada crédito remanescente e substitui a pendência quando a extra é aprovada', () => {
    const approvalPolicy = { ...policy, categories: categories.map((item) => item.id === 'banco' ? { ...item, requiresApproval: true } : item) };
    const pending = computeBankDay(day({ date: '2026-01-10', policy: approvalPolicy, shift: { ...shift, referenceMinutes: 360 },
      markings: punches('2026-01-10', '10:00', '13:00', '13:15', '17:15') }));
    const approved = buildStatement({ period: null, today: '2026-01-20', openingMinutes: 0, missing: [],
      months: [{ competence: '2026-01', closureVersion: 1, days: [pending], totals: monthTotals([pending]) }],
      movements: [{ id: 'm1', uid: 'u', date: '2026-01-10', competence: '2026-01', status: 'active', kind: 'overtime_approval', minutes: 60,
        reason: 'Extra aprovada pelo DP.', createdAt: '2026-01-11T00:00:00Z', createdBy: 'dp', categoryId: 'banco', replacesMinutes: 60,
        line: { nature: 'bank_credit', minutes: 90, reason: 'approved_overtime', categoryId: 'banco', factor: 1.5, ratePercent: 50 } }],
      timeBank: policy.timeBank });
    assert.deepEqual([approved.credit, approved.review, approved.balanceMinutes], [90, 0, 90]);
    const expired = buildStatement({ period: null, today: '2026-02-20', openingMinutes: 0, missing: [],
      months: [{ competence: '2026-01', closureVersion: 1, days: [{ ...pending, lines: [{ nature: 'bank_credit', minutes: 90, reason: 'worked_more' }] }], totals: monthTotals([]) }],
      timeBank: { ...policy.timeBank, expirationDays: 30, expiredBalanceDestination: 'payroll' } });
    assert.deepEqual([expired.credit, expired.debit, expired.payroll, expired.balanceMinutes], [90, 90, 90, 0]);
  });

  it('transporta movimentos anteriores e ignora aprovação vinculada a versão reaberta', () => {
    const prior = computeBankDay(day({ date: '2026-09-21', shift: { ...shift, referenceMinutes: 300 },
      markings: punches('2026-09-21', '10:00', '13:00', '13:15', '16:15') }));
    const current = computeBankDay(day({ date: '2026-10-10', markings: punches('2026-10-10', '10:00', '13:00', '13:15', '16:15') }));
    const movement = { id: 'm', uid: 'u', date: '2026-09-25', competence: '2026-09', status: 'active' as const, kind: 'compensation' as const,
      minutes: 30, reason: 'Compensação do ciclo anterior.', createdAt: '2026-09-25T12:00:00Z', createdBy: 'dp',
      line: { nature: 'bank_debit' as const, minutes: 30, reason: 'manual_compensation' as const } };
    const statement = buildStatement({ period: { start: '2026-10-01', end: '2026-10-31', index: 9 }, today: '2026-10-20', missing: [], openingMinutes: 0,
      carryFrom: '2026-09-01',
      months: [{ competence: '2026-09', closureVersion: 1, days: [prior], totals: monthTotals([prior]) },
        { competence: '2026-10', closureVersion: 1, days: [current], totals: monthTotals([current]) }], movements: [movement], timeBank: policy.timeBank });
    assert.deepEqual([statement.openingMinutes, statement.balanceMinutes], [60, -20]);

    const approvalPolicy = { ...policy, categories: categories.map((item) => item.id === 'banco' ? { ...item, requiresApproval: true } : item) };
    const pending = computeBankDay(day({ date: '2026-10-10', policy: approvalPolicy, shift: { ...shift, referenceMinutes: 360 },
      markings: punches('2026-10-10', '10:00', '13:00', '13:15', '17:15') }));
    const stale = bankLinesWithMovements([{ competence: '2026-10', closureVersion: 2, days: [pending], totals: monthTotals([pending]) }], [{
      id: 'approval', uid: 'u', date: '2026-10-10', competence: '2026-10', status: 'active', kind: 'overtime_approval', minutes: 60,
      reason: 'Aprovação da versão anterior.', createdAt: '2026-10-11T00:00:00Z', createdBy: 'dp', categoryId: 'banco', replacesMinutes: 60,
      sourceClosureVersion: 1, line: { nature: 'bank_credit', minutes: 90, reason: 'approved_overtime', categoryId: 'banco', factor: 1.5 },
    }]);
    assert.deepEqual(stale.map((item) => item.line.reason), ['pending_approval']);
  });

  it('não leva dias do ciclo anterior no mesmo mês sem transporte e respeita o marco do transporte', () => {
    const before = computeBankDay(day({ date: '2026-10-05', shift: { ...shift, referenceMinutes: 300 },
      markings: punches('2026-10-05', '10:00', '13:00', '13:15', '16:15') }));
    const carried = computeBankDay(day({ date: '2026-10-12', shift: { ...shift, referenceMinutes: 300 },
      markings: punches('2026-10-12', '10:00', '13:00', '13:15', '16:15') }));
    const current = computeBankDay(day({ date: '2026-10-18', markings: punches('2026-10-18', '10:00', '13:00', '13:15', '16:15') }));
    const months = [{ competence: '2026-10', closureVersion: 1, days: [before, carried, current], totals: monthTotals([before, carried, current]) }];
    const period = { start: '2026-10-16', end: '2026-10-30', index: 1 };
    const noCarry = buildStatement({ period, today: '2026-10-20', missing: [], openingMinutes: 0, months, timeBank: policy.timeBank });
    assert.deepEqual([noCarry.openingMinutes, noCarry.credit, noCarry.debit, noCarry.balanceMinutes], [0, 0, 80, -80]);
    const withCarry = buildStatement({ period, today: '2026-10-20', missing: [], openingMinutes: 0, months,
      carryFrom: '2026-10-10', timeBank: policy.timeBank });
    assert.deepEqual([withCarry.openingMinutes, withCarry.balanceMinutes], [90, 10]);
  });
});
