import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDayView, type DayShift } from '../../src/features/dp/rep-p/day-model';
import { computeBankDay, type BankShift } from '../../src/features/dp/time-bank/core';

const at = (clock: string, date = '2026-11-10') => `${date}T${clock}:00-0300`;
type Options = { end?: string; tolerance?: number | null; rule?: boolean; policy?: { markingMinutes: number; dailyMinutes: number };
  coverage?: boolean; marks?: string[] };

/** O mesmo dia pelas duas contas: a do banco de horas e a da tela. */
function night(entry: string, exit: string, { end = '22:00', tolerance = 5, rule = true, policy, coverage, marks }: Options = {}) {
  const punches = marks ?? [entry, exit];
  const tolerances = policy ? { ...policy, breakMinutes: { upTo15: 0, upTo30: 0, upTo60: 0 } } : undefined;
  const common = { type: 'work' as const, startTime: '14:00', endTime: end, toleranceMinutes: tolerance, referenceMinutes: coverage ? 600 : 480,
    ...(coverage ? { coverage: true } : {}), ...(rule ? { nightToleranceRule: true } : {}) };
  const bankShift: BankShift = { ...common, overnight: false, plannedMinutes: 480, journeyId: 'j' };
  const bank = computeBankDay({ date: '2026-11-10', shift: bankShift, markings: punches.map((clock) => at(clock)), holiday: false, absences: [],
    policy: tolerances ? { id: 'p', version: 1, categories: [], timeBank: { enabled: true }, tolerances } as never : null });
  const screenShift = { ...common, breakType: 'none', ...(tolerances ? { policyTolerances: tolerances } : {}) } as unknown as DayShift;
  const screen = buildDayView({ date: '2026-11-10', today: '2026-11-19', shift: screenShift, absences: [],
    markings: punches.map((clock, index) => ({ receiptId: `r${index}`, markedAt: at(clock), nsr: index + 1, executionUnitId: 'u', receiptStatus: 'available' as const })) });
  assert.equal(screen.nightMinutes, bank.nightMinutes, `tela e banco divergem em ${punches.join(' ')}`);
  assert.equal(bank.issues.includes('NIGHT_SHIFT'), bank.nightMinutes > 0);
  return bank.nightMinutes;
}

test('turno até 22h, tolerância 5: até 22:05 não há noturno; passou, contam todos os minutos', () => {
  assert.equal(night('14:00', '22:03'), 0);
  assert.equal(night('14:00', '22:05'), 0);
  assert.equal(night('14:00', '22:06'), 6);
  assert.equal(night('14:00', '22:08'), 8);
});

test('sem tolerância na jornada, todo minuto depois das 22h conta', () => {
  assert.equal(night('14:00', '22:03', { tolerance: 0 }), 3);
  assert.equal(night('14:00', '22:03', { tolerance: null }), 3);
});

test('vale a soma do dia, como no saldo: entrada já gastou a tolerância', () => {
  assert.equal(night('14:04', '22:03'), 3);
  assert.equal(night('13:57', '22:03'), 3);
  assert.equal(night('13:57', '22:03', { tolerance: 10 }), 0);
});

test('com política, vale a tolerância dela', () => {
  const policy = { markingMinutes: 5, dailyMinutes: 10 };
  assert.equal(night('14:00', '22:05', { policy, tolerance: 0 }), 0);
  assert.equal(night('14:00', '22:06', { policy }), 6);
  assert.equal(night('13:57', '22:04', { policy }), 0);
  assert.equal(night('14:00', '22:04', { policy: { markingMinutes: 3, dailyMinutes: 6 } }), 4);
  assert.equal(night('13:50', '22:03', { policy }), 3, 'entrada fora da janela legal: tudo conta');
});

test('só no turno que termina às 22h, fora da cobertura e com a chave ligada', () => {
  assert.equal(night('14:00', '22:32', { end: '22:30' }), 32);
  assert.equal(night('14:00', '22:03', { coverage: true }), 3);
  assert.equal(night('14:00', '22:03', { rule: false }), 3);
});

test('só os minutos da saída saem da conta; período iniciado depois das 22h continua noturno', () => {
  assert.equal(night('', '', { marks: ['14:00', '18:00', '19:00', '22:04'] }), 0);
  assert.equal(night('', '', { marks: ['14:00', '21:55', '22:01', '22:04'] }), 3);
});
