import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { buildMonthView, type DayShift } from '../../src/features/dp/rep-p/day-model';
import { assembleMonthDays, businessToday, DAY_ALGORITHM_VERSION, monthAbsencesOf } from '../../src/features/dp/rep-p/month-days';

const shift: DayShift = { type: 'work', startTime: '09:00', endTime: '15:15', shiftName: 'CS - 01 AT | Manhã', unitName: 'Quiosque',
  breakType: 'fixed', breakStart: '12:00', breakEnd: '12:15', breakDurationMinutes: 15, breakWindowStart: null, breakWindowEnd: null,
  expectedPunches: 4, toleranceMinutes: 5, unitId: 'u' };
const mark = (date: string, time: string, nsr: number) => ({ receiptId: `r${nsr}`, markedAt: `${date}T${time}:00-0300`, nsr,
  executionUnitId: 'u', receiptStatus: 'available' as const, workDate: date });

// Mês com os casos que a conferência mostra hoje: dia certo, ímpar, saída tardia, falta, ausência e tratamento.
const input = {
  month: '2026-11',
  today: '2026-11-25',
  shifts: ['2026-11-20', '2026-11-21', '2026-11-23', '2026-11-24', '2026-11-25'].map((date) => ({ ...shift, date })),
  markings: [
    mark('2026-11-20', '09:00', 1), mark('2026-11-20', '12:00', 2), mark('2026-11-20', '12:15', 3), mark('2026-11-20', '15:15', 4),
    mark('2026-11-21', '09:00', 5), mark('2026-11-21', '12:00', 6), mark('2026-11-21', '12:15', 7),
    mark('2026-11-24', '09:00', 8), mark('2026-11-24', '12:00', 9), mark('2026-11-24', '12:15', 10), mark('2026-11-24', '18:00', 11),
    mark('2026-11-25', '08:58', 12),
  ],
  absences: [{ id: 'a', typeName: 'Atestado', status: 'approved', startDate: '2026-11-23', endDate: '2026-11-23' }],
  treatments: [{ type: 'inclusion' as const, workDate: '2026-11-21', adjustmentId: 'adj', originalReceiptId: null,
    markedAt: '2026-11-21T15:15:00-0300', executionUnitId: 'u' }],
};

describe('Contrato central do dia', () => {
  it('entrega exatamente o mesmo resultado do cálculo atual da tela', () => {
    const central = assembleMonthDays(input);
    assert.deepEqual(central.days, buildMonthView(input));
    assert.equal(central.days.length, 30);
    const byDate = new Map(central.days.map((day) => [day.date, day]));
    assert.deepEqual(byDate.get('2026-11-20')?.incidents, []);
    assert.deepEqual(byDate.get('2026-11-21')?.incidents, [], 'a batida incluída por ajuste fecha o período');
    assert.deepEqual(byDate.get('2026-11-23')?.incidents, [], 'ausência aprovada cobre o dia');
    assert.deepEqual(byDate.get('2026-11-24')?.incidents, ['late_exit']);
    assert.deepEqual(byDate.get('2026-11-25')?.incidents, [], 'hoje não vira ímpar');
  });

  it('declara o mês, o dia de referência e a versão do algoritmo', () => {
    const central = assembleMonthDays(input);
    assert.equal(central.month, '2026-11');
    assert.equal(central.today, '2026-11-25');
    assert.equal(central.algorithmVersion, DAY_ALGORITHM_VERSION);
  });

  it('ausências do mês: ignora rascunho, recusada e cancelada; licença longa iniciada antes do mês ainda cobre', () => {
    const record = (id: string, status: string, startDate: string, endDate: string, extra = {}) =>
      ({ id, status, startDate, endDate, typeId: 'tipo', typeSnapshot: { name: 'Atestado' }, ...extra }) as never;
    const absences = monthAbsencesOf([
      record('longa', 'approved', '2026-09-01', '2026-11-10'),
      record('acabou', 'approved', '2026-09-01', '2026-10-31'),
      record('rascunho', 'draft', '2026-11-03', '2026-11-03'),
      record('recusada', 'rejected', '2026-11-04', '2026-11-04'),
      record('cancelada', 'cancelled', '2026-11-05', '2026-11-05'),
      record('tacita', 'approved', '2026-11-06', '2026-11-06', { approvalOrigin: 'tacit_timeout' }),
      record('analise', 'in_review', '2026-11-07', '2026-11-07'),
    ], '2026-11-01');
    assert.deepEqual(absences.map((item) => item.id), ['longa', 'tacita', 'analise']);
    assert.equal(absences.find((item) => item.id === 'tacita')?.approvedByInaction, true);
    assert.equal(absences[0].typeName, 'Atestado');
  });

  it('mudar a regra do dia sem subir DAY_ALGORITHM_VERSION quebra este teste', () => {
    // Impressão digital do resultado de referência por versão. Se a regra mudar de propósito, suba a versão em
    // month-days.ts e registre aqui a nova impressão; as anteriores ficam para rastreabilidade.
    const fingerprints: Record<number, string> = {
      1: 'f9b5f6e6ab3077ef37c10fccb6ceeb467bbba9d2b60e2a8965eb67fd07e4f5f2',
      // 2: tolerância só no início e fim, entrada após/saída antes do previsto, política de cobertura.
      2: 'c2f713879a8cbca80cc75c707bec9152d03b1c6ff3854a041a00c0f94e4b6c59',
    };
    const actual = createHash('sha256').update(JSON.stringify(assembleMonthDays(input).days)).digest('hex');
    assert.equal(actual, fingerprints[DAY_ALGORITHM_VERSION],
      'A saída do dia mudou: suba DAY_ALGORITHM_VERSION e registre a nova impressão.');
  });

  it('na virada da meia-noite em São Luís, o dia de ontem passa a ser avaliado', () => {
    const before = assembleMonthDays({ ...input, today: businessToday(new Date('2026-11-26T02:59:00Z')) });
    const after = assembleMonthDays({ ...input, today: businessToday(new Date('2026-11-26T03:01:00Z')) });
    assert.equal(before.today, '2026-11-25');
    assert.equal(after.today, '2026-11-26');
    assert.deepEqual(before.days.find((day) => day.date === '2026-11-25')?.incidents, [], 'em curso: uma batida não é ímpar');
    assert.deepEqual(after.days.find((day) => day.date === '2026-11-25')?.incidents, ['odd'], 'depois da meia-noite: ímpar');
  });

  it('calcula hoje no fuso do negócio, não em UTC', () => {
    // 01:30 UTC de 26/11 ainda é 22:30 de 25/11 em São Luís.
    assert.equal(businessToday(new Date('2026-11-26T01:30:00Z')), '2026-11-25');
    assert.equal(businessToday(new Date('2026-11-26T03:00:00Z')), '2026-11-26');
  });
});
