import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDayView, type DayShift } from '../../src/features/dp/rep-p/day-model';
import { computeBankDay, monthTotals, type BankPolicy, type BankShift } from '../../src/features/dp/time-bank/core';
import { breakToleranceFor, LEGAL_INTRAJORNADA_DEFAULT, LEGAL_TOLERANCE_DEFAULTS, suppressedBreakMinutes } from '../../src/features/dp/time-config/policy-rules';
import { policyRulesFormFor, policyRulesFromForm } from '../../src/features/dp/time-config/policy-rules-form';
import { createOvertimePolicySchema } from '../../src/features/dp/time-config/schemas';

const base: BankPolicy = { id: 'p', version: 2, categories: [{ id: 'HE1 - 50%', name: 'HE1', trigger: 'workday', ratePercent: 50, destination: 'payroll', requiresApproval: false }],
  timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review' } };
const policy: BankPolicy = { ...base, tolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: LEGAL_INTRAJORNADA_DEFAULT };
const shift: BankShift = { type: 'work', startTime: '08:00', endTime: '17:00', overnight: false, plannedMinutes: 480, referenceMinutes: 480,
  toleranceMinutes: 5, journeyId: 'j', breakMinutes: 60 };
const at = (...times: string[]) => times.map((time) => `2026-12-02T${time}:00-0300`);
const bank = (times: string[], overrides: Partial<BankShift> = {}, rules: BankPolicy = policy) =>
  computeBankDay({ date: '2026-12-02', shift: { ...shift, ...overrides }, markings: at(...times), absences: [], holiday: false, policy: rules });
const indemnity = (result: ReturnType<typeof bank>) => result.lines.filter((line) => line.nature === 'payroll_indemnity');

describe('Tolerância do intervalo (total: saída + volta)', () => {
  it('15, 30 e 60 min usam a tabela; outros tamanhos usam a proporção arredondada para baixo, até o valor de 60', () => {
    assert.deepEqual([15, 30, 60, 45, 90].map((value) => breakToleranceFor(value, LEGAL_TOLERANCE_DEFAULTS)), [1, 2, 5, 3, 5]);
    assert.equal(suppressedBreakMinutes(60, 55, 5), 0);
    assert.equal(suppressedBreakMinutes(60, 54, 5), 6);
  });

  it('5 min somados entre saída e volta ficam dentro; com 6 paga os 6 inteiros', () => {
    assert.deepEqual(indemnity(bank(['08:00', '12:02', '12:57', '17:00'])), []);
    assert.deepEqual(indemnity(bank(['08:00', '12:03', '12:57', '17:00'])),
      [{ nature: 'payroll_indemnity', minutes: 6, reason: 'break_suppressed', categoryId: 'HEI - 50%', ratePercent: 50 }]);
  });

  it('a indenização é parcela própria, separada da hora trabalhada a mais, e entra no total do mês', () => {
    const result = bank(['07:58', '12:03', '12:55', '17:02']);
    assert.equal(indemnity(result)[0]?.minutes, 8);
    assert.equal(result.lines.some((line) => line.nature === 'payroll_overtime'), true);
    assert.equal(monthTotals([result]).indemnity, 8);
  });

  it('turno de 6h tolera 1 min no intervalo de 15; na cobertura acima de 6h vale 1h em uma pausa', () => {
    const short = { breakMinutes: 15, plannedMinutes: 360, referenceMinutes: 360, endTime: '14:15' };
    assert.deepEqual(indemnity(bank(['08:00', '11:00', '11:14', '14:15'], short)), []);
    assert.equal(indemnity(bank(['08:00', '11:00', '11:13', '14:15'], short))[0]?.minutes, 2);
    const coverage = bank(['08:00', '12:00', '12:30', '17:00'], { breakMinutes: 15, plannedMinutes: 360, coverage: true });
    assert.equal(indemnity(coverage)[0]?.minutes, 30);
  });

  it('até 4h não há intervalo obrigatório', () => {
    assert.deepEqual(indemnity(bank(['08:00', '10:00', '10:05', '11:55'])), []);
    assert.equal(bank(['08:00', '11:50']).issues.includes('BREAK_REVIEW'), false);
  });

  it('caso com dúvida não paga sozinho: vai para o DP', () => {
    const cases: Array<[string, ReturnType<typeof bank>]> = [
      ['sem pausa', bank(['08:00', '17:00'])],
      ['pausas divididas', bank(['08:00', '10:00', '10:30', '12:00', '12:30', '17:00'])],
      ['turno de 6h estendido', bank(['08:00', '11:00', '11:15', '15:00'], { breakMinutes: 15, plannedMinutes: 360 })],
      ['intervalo reduzido de 30', bank(['08:00', '12:00', '12:30', '17:00'], { breakMinutes: 30 })],
      ['turno manual', bank(['08:00', '12:00', '12:30', '17:00'], { manual: true })],
      ['turno noturno', bank(['08:00', '12:00', '12:30', '17:00'], { overnight: true })],
    ];
    for (const [label, result] of cases) {
      assert.deepEqual(indemnity(result), [], label);
      assert.equal(result.issues.includes('BREAK_REVIEW'), true, label);
    }
  });

  it('dia que a apuração mandou para conferência não lança a parcela', () => {
    const result = computeBankDay({ date: '2026-12-02', shift, markings: at('08:00', '12:00', '12:30', '17:00'), absences: [], holiday: true, policy });
    assert.deepEqual(indemnity(result), []);
    assert.equal(result.issues.includes('BREAK_REVIEW'), true);
  });

  it('não lança nada com batida ímpar ou sem a regra na política', () => {
    assert.deepEqual(indemnity(bank(['08:00', '12:00', '12:10'])), []);
    assert.deepEqual(indemnity(bank(['08:00', '12:00', '12:10', '17:00'], {}, base)), []);
  });
});

describe('Tolerância de entrada e saída pela política', () => {
  it('a política permite 5 por marcação e 10 no dia, no lugar da tolerância da jornada', () => {
    const times = ['08:04', '12:00', '13:00', '16:56'];
    assert.equal(bank(times).toleranceApplied, true);
    assert.equal(bank(times, {}, base).toleranceApplied, false);
    assert.equal(bank(['08:06', '12:00', '13:00', '17:00']).toleranceApplied, false);
  });

  it('política mais estreita não desconta o que está dentro de 5/10, mas deixa o que sobra contar', () => {
    const narrow = { ...base, tolerances: { ...LEGAL_TOLERANCE_DEFAULTS, markingMinutes: 0, dailyMinutes: 0 } };
    assert.equal(bank(['08:03', '12:00', '13:00', '17:00'], {}, narrow).consideredMinutes, 480);
    assert.equal(bank(['08:00', '12:00', '13:00', '17:03'], {}, narrow).consideredMinutes, 483);
    assert.equal(bank(['07:57', '12:00', '13:00', '16:57'], {}, narrow).consideredMinutes, 483);
    assert.equal(bank(['08:06', '12:00', '13:00', '17:00'], {}, narrow).consideredMinutes, 474);
  });

  it('jornada sem tolerância passa a ter a da política', () => {
    assert.equal(bank(['08:05', '12:00', '13:00', '17:00'], { toleranceMinutes: null }).toleranceApplied, true);
  });
});

describe('Registro de ponto', () => {
  const dayShift: DayShift = { type: 'work', startTime: '08:00', endTime: '17:00', shiftName: 'CD', unitName: 'CD', breakType: 'flexible',
    breakStart: null, breakEnd: null, breakDurationMinutes: 60, breakWindowStart: null, breakWindowEnd: null, expectedPunches: 4, toleranceMinutes: 5 };
  const view = (times: string[], extra: Partial<DayShift> = {}) => buildDayView({ date: '2026-12-02', today: '2026-12-03', shift: { ...dayShift, ...extra }, absences: [],
    markings: at(...times).map((markedAt, index) => ({ receiptId: `r${index}`, markedAt, nsr: index + 1, executionUnitId: 'u', receiptStatus: 'available' as const })) });
  const rules = { policyTolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: true };

  it('o saldo do dia segue a mesma regra do banco: 4 + 4 min nas pontas contam como no horário', () => {
    assert.equal(view(['08:04', '12:00', '13:00', '16:56'], rules).balanceMinutes, 0);
    assert.equal(view(['08:04', '12:00', '13:00', '16:56']).balanceMinutes, -8);
  });

  it('cobertura: a prévia dá o mesmo saldo da apuração', () => {
    const times = ['07:58', '11:58', '12:58', '16:57'];
    const preview = view(times, { ...rules, coverage: true, referenceMinutes: 480, endTime: '14:15', breakDurationMinutes: 15 });
    const official = bank(times, { coverage: true, plannedMinutes: 360, endTime: '14:15', breakMinutes: 15 });
    assert.equal(preview.balanceMinutes, 0);
    assert.equal(official.consideredMinutes, 480);
  });

  it('dia sem pausa e turno manual ou noturno viram alerta grave a decidir, sem valor a pagar', () => {
    const noPause = view(['08:00', '17:00'], rules);
    assert.equal(noPause.breakReview, 'no_pause');
    assert.equal(noPause.incidents.includes('short_break'), true);
    assert.equal(noPause.suppressedBreakMinutes, undefined);
    const overnight = view(['08:00', '12:00', '12:30', '17:00'], { ...rules, overnight: true });
    assert.equal(overnight.breakReview, 'unsupported_shift');
    assert.equal(overnight.incidents.includes('short_break'), true);
  });

  it('sem política, qualquer minuto a menos é alerta e nada é indenizado', () => {
    const result = view(['08:00', '12:00', '12:59', '17:00']);
    assert.equal(result.incidents.includes('short_break'), true);
    assert.equal(result.suppressedBreakMinutes, undefined);
  });

  it('com a política, 5 min passam sem alerta e 8 geram alerta com todo o suprimido', () => {
    assert.equal(view(['08:00', '12:00', '12:55', '17:00'], rules).incidents.includes('short_break'), false);
    const result = view(['07:58', '12:03', '12:55', '17:02'], rules);
    assert.equal(result.incidents.includes('short_break'), true);
    assert.equal(result.suppressedBreakMinutes, 8);
  });
});

describe('Esquema da política', () => {
  const input = { name: 'CCT', applicability: { scope: { kind: 'company' as const } }, validFrom: '2026-12-01', categories: base.categories,
    timeBank: base.timeBank, externalCoverageRule: 'origin' as const };
  const ok = (extra: object) => createOvertimePolicySchema.safeParse({ ...input, ...extra }).success;

  it('aceita o modelo padrão e políticas antigas sem os campos', () => {
    assert.equal(ok({}), true);
    assert.equal(ok({ tolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: LEGAL_INTRAJORNADA_DEFAULT }), true);
  });

  it('recusa tolerância acima do teto, adicional abaixo de 50% e intrajornada sem tolerâncias', () => {
    assert.equal(ok({ tolerances: { ...LEGAL_TOLERANCE_DEFAULTS, markingMinutes: 6 } }), false);
    assert.equal(ok({ tolerances: { ...LEGAL_TOLERANCE_DEFAULTS, dailyMinutes: 11 } }), false);
    assert.equal(ok({ tolerances: { ...LEGAL_TOLERANCE_DEFAULTS, breakMinutes: { upTo15: 2, upTo30: 2, upTo60: 5 } } }), false);
    assert.equal(ok({ tolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: { ...LEGAL_INTRAJORNADA_DEFAULT, ratePercent: 40 } }), false);
    assert.equal(ok({ intrajornada: LEGAL_INTRAJORNADA_DEFAULT }), false);
  });
});

describe('Editor da política', () => {
  const enabled = () => ({ ...policyRulesFormFor(), tolerancesEnabled: true, intrajornadaEnabled: true });

  it('política nova nasce com os valores preenchidos e as regras desligadas', () => {
    assert.deepEqual(policyRulesFromForm(policyRulesFormFor()), { tolerances: null, intrajornada: null });
    assert.deepEqual(policyRulesFromForm(enabled()), { tolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: LEGAL_INTRAJORNADA_DEFAULT });
    assert.deepEqual(policyRulesFromForm(policyRulesFormFor({ tolerances: LEGAL_TOLERANCE_DEFAULTS })).intrajornada, null);
  });

  it('desligar as tolerâncias desliga também a intrajornada', () => {
    assert.deepEqual(policyRulesFromForm({ ...enabled(), tolerancesEnabled: false }), { tolerances: null, intrajornada: null });
    assert.equal(policyRulesFromForm({ ...enabled(), intrajornadaEnabled: false }).intrajornada, null);
  });

  it('recusa campo vazio, acima do teto ou adicional abaixo de 50%', () => {
    assert.throws(() => policyRulesFromForm({ ...enabled(), markingMinutes: '' }));
    assert.throws(() => policyRulesFromForm({ ...enabled(), upTo15: '2' }));
    assert.throws(() => policyRulesFromForm({ ...enabled(), intrajornadaRate: '40' }));
  });
});
