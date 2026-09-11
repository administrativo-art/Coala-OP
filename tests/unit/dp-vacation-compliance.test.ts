import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeVacationScheduling, vacationEntitlementDays } from '../../src/lib/dp-vacation-workflow';
import { updateVacationSchema } from '../../src/features/hr/vacations/schemas';

test('calcula o direito de férias pelas faixas de faltas injustificadas', () => {
  assert.deepEqual(
    [0, 5, 6, 14, 15, 23, 24, 32, 33].map(vacationEntitlementDays),
    [30, 30, 24, 24, 18, 18, 12, 12, 0],
  );
});

test('bloqueia início nos dois dias anteriores ao repouso semanal', () => {
  const analysis = analyzeVacationScheduling({
    recordType: 'gozo',
    startDate: '2026-10-02',
    endDate: '2026-10-15',
    asOfDate: '2026-09-01',
    calendarConfigured: true,
    holidays: [],
    weeklyRestDay: 0,
    cycleRecords: [{ recordType: 'gozo', startDate: '2026-10-02', endDate: '2026-10-15', days: 14 }],
    entitledDays: 30,
    acquisitionPeriodEnd: '2026-08-31',
    concessiveDeadline: '2027-08-31',
  });
  const calendar = analysis.checks.find((check) => check.code === 'calendar_review');
  assert.equal(calendar?.status, 'blocked');
  assert.equal(calendar?.blocking, true);
});

test('exige concordância, período de 14 dias e saldo dentro do direito ao fracionar', () => {
  const common = {
    recordType: 'gozo' as const,
    startDate: '2026-11-01',
    endDate: '2026-11-10',
    asOfDate: '2026-09-01',
    calendarConfigured: true,
    holidays: [],
    weeklyRestDay: 3,
    cycleRecords: [
      { recordType: 'gozo' as const, days: 10, status: 'APPROVED' as const },
      { recordType: 'gozo' as const, days: 10, status: 'PLANNED' as const },
      { recordType: 'gozo' as const, days: 10, status: 'PLANNED' as const },
    ],
    entitledDays: 30,
    acquisitionPeriodEnd: '2026-08-31',
    concessiveDeadline: '2027-08-31',
  };
  const blocked = analyzeVacationScheduling({ ...common, employeeAgreedToSplit: false });
  assert.equal(blocked.checks.find((check) => check.code === 'cycle_review')?.status, 'blocked');
  assert.equal(blocked.checks.find((check) => check.code === 'employee_agreement')?.status, 'blocked');

  const valid = analyzeVacationScheduling({
    ...common,
    cycleRecords: [
      { recordType: 'gozo', days: 14, status: 'APPROVED' },
      { recordType: 'gozo', days: 8, status: 'APPROVED' },
      { recordType: 'gozo', days: 8, status: 'PLANNED' },
    ],
    employeeAgreedToSplit: true,
  });
  assert.equal(valid.checks.find((check) => check.code === 'cycle_review')?.status, 'ok');
  assert.equal(valid.checks.find((check) => check.code === 'employee_agreement')?.status, 'ok');

  const agreementAlreadyRecorded = analyzeVacationScheduling({
    ...common,
    cycleRecords: [
      { recordType: 'gozo', days: 14, status: 'APPROVED', employeeAgreedToSplit: true },
      { recordType: 'gozo', days: 8, status: 'PLANNED' },
    ],
    employeeAgreedToSplit: false,
  });
  assert.equal(agreementAlreadyRecorded.checks.find((check) => check.code === 'employee_agreement')?.status, 'ok');
});

test('bloqueia abono acima de um terço ou solicitado depois do prazo', () => {
  const analysis = analyzeVacationScheduling({
    recordType: 'venda',
    asOfDate: '2026-09-01',
    cycleRecords: [{ recordType: 'venda', days: 9, status: 'PLANNED' }],
    entitledDays: 24,
    acquisitionPeriodEnd: '2026-08-31',
    concessiveDeadline: '2027-08-31',
    allowanceRequestedAt: '2026-08-20',
  });
  assert.equal(analysis.checks.find((check) => check.code === 'allowance_deadline')?.status, 'blocked');
});

test('valida o prazo de cada pedido de abono do ciclo', () => {
  const analysis = analyzeVacationScheduling({
    recordType: 'venda',
    asOfDate: '2026-09-01',
    cycleRecords: [
      { recordType: 'venda', days: 3, status: 'APPROVED', allowanceRequestedAt: '2026-08-01' },
      { recordType: 'venda', days: 3, status: 'PLANNED', allowanceRequestedAt: '2026-08-20' },
    ],
    entitledDays: 30,
    acquisitionPeriodEnd: '2026-08-31',
    concessiveDeadline: '2027-08-31',
  });
  assert.equal(analysis.checks.find((check) => check.code === 'allowance_deadline')?.status, 'blocked');
});

test('validação do recibo exige que bruto menos descontos feche com líquido', () => {
  const result = updateVacationSchema.safeParse({
    action: 'review_receipt',
    decision: 'approved',
    values: { grossAmount: 2_000, discountAmount: 300, netAmount: 1_800, paymentDate: '2026-09-29' },
  });
  assert.equal(result.success, false);
});

test('rejeição e cancelamento exigem motivo formal', () => {
  assert.equal(updateVacationSchema.safeParse({ action: 'reject', reason: 'curto' }).success, false);
  assert.equal(updateVacationSchema.safeParse({ action: 'cancel', reason: 'Motivo formal registrado.' }).success, true);
});
