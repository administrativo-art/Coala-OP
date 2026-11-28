import assert from 'node:assert/strict';
import test from 'node:test';

import { applyWeeklyOvertimeLimits, computeBankDay, type BankDayInput, type BankPolicy, type BankShift } from '../../src/features/dp/time-bank/core';
import { applyOvertimeDecision, decidableOvertimeMinutes, decisionProblem, overtimeOptions, type OvertimeDecision, type OvertimePart } from '../../src/features/dp/time-bank/overtime-decision';
import { payrollReviewReason } from '../../src/features/dp/time-bank/payroll-readiness';

// Mesmas faixas da política publicada lida em 25/11/2026: HE1 pede aprovação; folga e fora da escala não têm faixa.
const policy: BankPolicy = { id: 'p', version: 1, timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review' },
  categories: [
    { id: 'he1', name: 'HE1', trigger: 'workday', ratePercent: 50, destination: 'payroll', requiresApproval: true },
    { id: 'feriado', name: 'Feriado', trigger: 'holiday', ratePercent: 100, destination: 'payroll', requiresApproval: false },
    { id: 'domingo', name: 'Domingo', trigger: 'sunday', ratePercent: 100, destination: 'payroll', requiresApproval: false },
  ] } as BankPolicy;
const shift: BankShift = { type: 'work', startTime: '08:00', endTime: '12:00', overnight: false, plannedMinutes: 240, referenceMinutes: 240, toleranceMinutes: 0, journeyId: 'j' };
const TUESDAY = '2026-12-01';
const SUNDAY = '2026-12-06';
const day = (date: string, input: Partial<BankDayInput> = {}, exit = '13:00') => computeBankDay({ date, shift, policy, holiday: false, absences: [],
  markings: [`${date}T08:00:00-0300`, `${date}T${exit}:00-0300`], ...input });
const decide = (parts: OvertimePart[], sourceMinutes = 60): OvertimeDecision => ({ date: TUESDAY, sourceMinutes, policy: { id: 'p', version: 1 }, parts,
  reason: 'Cobertura de colega', decidedBy: 'dp', decidedAt: '2026-12-02T12:00:00.000Z' });
const keys = (date: string, input: Partial<BankDayInput> = {}, rules = policy) =>
  overtimeOptions(day(date, input), rules).options.map((item) => `${item.destination}:${item.categoryId}`);
const lines = (value: ReturnType<typeof day>) => value.lines.map((line) => `${line.nature}:${line.minutes}:${line.reason}`);

test('opção B: só a faixa do tipo do dia; banco a partir de faixa de folha apenas em dia útil', () => {
  assert.deepEqual(keys(TUESDAY), ['payroll:he1', 'time_bank:he1']);
  assert.deepEqual(keys(SUNDAY), ['payroll:domingo']);
  assert.deepEqual(keys(SUNDAY, { shift: { ...shift, type: 'day_off' }, holiday: true }), ['payroll:feriado', 'payroll:domingo']);
  assert.deepEqual(keys(TUESDAY, { shift: { ...shift, type: 'day_off' } }), [], 'folga sem faixa continua em conferência');
  assert.deepEqual(keys(TUESDAY, { shift: null }), [], 'fora da escala sem faixa continua em conferência');
  assert.deepEqual(keys(TUESDAY, {}, { ...policy, timeBank: { ...policy.timeBank, enabled: false } }), ['payroll:he1'], 'banco desligado não oferece banco');
});

test('banco declarado na própria faixa vale também no domingo, com o fator dela', () => {
  const rules = { ...policy, categories: [{ id: 'banco-dom', name: 'Domingo no banco', trigger: 'sunday' as const, ratePercent: 100, destination: 'time_bank' as const, bankCreditFactor: 2, requiresApproval: false }] };
  const raw = day(SUNDAY, { policy: rules });
  assert.deepEqual(keys(SUNDAY, { policy: rules }, rules), ['time_bank:banco-dom']);
  const applied = applyOvertimeDecision(raw, rules, decide([{ destination: 'time_bank', categoryId: 'banco-dom', minutes: 60 }]));
  assert.deepEqual(applied.lines.map((line) => [line.nature, line.minutes, line.factor]), [['bank_credit', 120, 2]]);
});

test('escolha dividida aprova a extra: sai da conferência e vai para folha e banco', () => {
  const raw = day(TUESDAY);
  assert.deepEqual(lines(raw), ['review:60:pending_approval']);
  assert.equal(decidableOvertimeMinutes(raw, policy), 60);
  const applied = applyOvertimeDecision(raw, policy, decide([{ destination: 'payroll', categoryId: 'he1', minutes: 40 }, { destination: 'time_bank', categoryId: 'he1', minutes: 20 }]));
  assert.deepEqual(lines(applied), ['payroll_overtime:40:worked_more', 'bank_credit:20:worked_more']);
  assert.ok(applied.lines.every((line) => line.decided && line.categoryId === 'he1' && line.ratePercent === 50));
  const month = { competence: '2026-12', closureVersion: 1, totals: {} as never, days: [applied] };
  assert.equal(payrollReviewReason(month, []), null);
});

test('escolha que deixou de valer não paga nada sozinha', () => {
  const decision = decide([{ destination: 'payroll', categoryId: 'he1', minutes: 60 }]);
  const changedTime = applyOvertimeDecision(day(TUESDAY, {}, '13:30'), policy, decision);
  assert.deepEqual(lines(changedTime), ['review:90:decision_outdated']);
  const newPolicy = { ...policy, version: 2 };
  assert.deepEqual(lines(applyOvertimeDecision(day(TUESDAY, { policy: newPolicy }), newPolicy, decision)), ['review:60:decision_outdated']);
  // Domingo que a política pagaria sozinho também espera a nova conferência.
  const sunday = day(SUNDAY);
  assert.deepEqual(lines(applyOvertimeDecision(sunday, policy, { ...decision, sourceMinutes: 30 })), ['review:60:decision_outdated']);
  // Sem extra no dia, a escolha antiga não cria lançamento.
  const none = day(TUESDAY, {}, '12:00');
  assert.deepEqual(applyOvertimeDecision(none, policy, decision), none);
});

test('faixa de outro tipo de dia, soma diferente e minutos quebrados são recusados', () => {
  const raw = day(TUESDAY);
  for (const parts of [
    [{ destination: 'payroll' as const, categoryId: 'domingo', minutes: 60 }],
    [{ destination: 'payroll' as const, categoryId: 'he1', minutes: 59 }],
    [{ destination: 'payroll' as const, categoryId: 'he1', minutes: 61 }],
    [{ destination: 'payroll' as const, categoryId: 'he1', minutes: 59.5 }, { destination: 'time_bank' as const, categoryId: 'he1', minutes: 0.5 }],
    [],
  ]) assert.notEqual(decisionProblem(raw, policy, decide(parts)), null, JSON.stringify(parts));
});

test('o excedente do limite diário fica em conferência e o limite semanal continua valendo', () => {
  const limited = { ...policy, dailyOvertimeLimitMinutes: 30, weeklyOvertimeLimitMinutes: 20,
    categories: policy.categories.map((item) => ({ ...item, requiresApproval: false })) };
  const raw = day(TUESDAY, { policy: limited });
  assert.equal(decidableOvertimeMinutes(raw, limited), 30);
  const applied = applyOvertimeDecision(raw, limited, decide([{ destination: 'payroll', categoryId: 'he1', minutes: 30 }], 30));
  assert.deepEqual(lines(applied), ['review:30:daily_limit_exceeded', 'payroll_overtime:30:worked_more']);
  assert.deepEqual(applyWeeklyOvertimeLimits([applied])[0].lines.map((line) => `${line.nature}:${line.minutes}:${line.reason}`),
    ['review:30:daily_limit_exceeded', 'payroll_overtime:20:worked_more', 'review:10:weekly_limit_exceeded']);
});

test('o limite diário também vale na faixa que pede aprovação', () => {
  const limited = { ...policy, dailyOvertimeLimitMinutes: 30 };
  const raw = day(TUESDAY, { policy: limited });
  assert.deepEqual(lines(raw), ['review:60:pending_approval'], 'sem escolha, nada muda');
  assert.equal(decidableOvertimeMinutes(raw, limited), 30);
  assert.notEqual(decisionProblem(raw, limited, decide([{ destination: 'payroll', categoryId: 'he1', minutes: 60 }])), null);
  assert.deepEqual(lines(applyOvertimeDecision(raw, limited, decide([{ destination: 'payroll', categoryId: 'he1', minutes: 30 }], 30))),
    ['review:30:daily_limit_exceeded', 'payroll_overtime:30:worked_more']);
});

test('banco desligado: o fator da faixa não infla o tempo escolhível', () => {
  const off = { ...policy, timeBank: { ...policy.timeBank, enabled: false },
    categories: [{ id: 'banco', name: 'Banco', trigger: 'workday' as const, ratePercent: 50, destination: 'time_bank' as const, bankCreditFactor: 1.5, requiresApproval: false }] };
  const raw = day(TUESDAY, { policy: off });
  assert.deepEqual(lines(raw), ['review:90:needs_review']);
  assert.equal(decidableOvertimeMinutes(raw, off), 60);
  assert.deepEqual(overtimeOptions(raw, off).options, []);
});
