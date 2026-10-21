import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDayView, buildMonthView, workedMinutes, type DayShift } from '../../src/features/dp/rep-p/day-model';

const shift: DayShift = { type: 'work', startTime: '10:00', endTime: '16:15', shiftName: 'Manhã', unitName: 'Quiosque', breakType: 'fixed',
  breakStart: '13:00', breakEnd: '13:15', breakDurationMinutes: 15, breakWindowStart: null, breakWindowEnd: null, expectedPunches: 4,
  toleranceMinutes: 5 };
const mark = (date: string, time: string, nsr: number) => ({ receiptId: `r${nsr}`, markedAt: `${date}T${time}:00-0300`, nsr, executionUnitId: 'u', receiptStatus: 'available' as const });

describe('Leitura do dia no Registro de ponto', () => {
  it('soma os pares, mede o intervalo e não acusa nada dentro da tolerância', () => {
    const day = buildDayView({ date: '2026-10-16', today: '2026-10-19', shift, absences: [],
      markings: [mark('2026-10-16', '16:16', 4), mark('2026-10-16', '09:58', 1), mark('2026-10-16', '13:00', 2), mark('2026-10-16', '13:13', 3)] });
    assert.deepEqual(day.markings.map((item) => item.nsr), [1, 2, 3, 4]);
    assert.equal(day.workedMinutes, 365);
    assert.equal(day.breakMinutes, 13);
    assert.deepEqual(day.incidents, []);
    assert.equal(day.balanceMinutes, 0);
  });

  it('acusa dia sem batida, batida ímpar, saída tardia e intervalo fora da tolerância', () => {
    assert.deepEqual(buildDayView({ date: '2026-10-09', today: '2026-10-19', shift, absences: [], markings: [] }).incidents, ['missing']);
    assert.deepEqual(buildDayView({ date: '2026-10-13', today: '2026-10-19', shift, absences: [],
      markings: [mark('2026-10-13', '10:00', 1), mark('2026-10-13', '13:00', 2), mark('2026-10-13', '13:15', 3)] }).incidents, ['odd']);
    const late = buildDayView({ date: '2026-10-17', today: '2026-10-19', shift, absences: [],
      markings: [mark('2026-10-17', '10:00', 1), mark('2026-10-17', '13:00', 2), mark('2026-10-17', '13:09', 3), mark('2026-10-17', '16:28', 4)] });
    assert.deepEqual(late.incidents, ['late_exit', 'short_break']);
    assert.deepEqual(late.deviation, { edge: 'end', minutes: 13 });
    const long = buildDayView({ date: '2026-10-12', today: '2026-10-19', shift, absences: [],
      markings: [mark('2026-10-12', '10:00', 1), mark('2026-10-12', '13:00', 2), mark('2026-10-12', '13:25', 3), mark('2026-10-12', '16:15', 4)] });
    assert.deepEqual(long.incidents, ['long_break']);
  });

  it('ausência aprovada ou em análise cobre o dia; recusada não; hoje não vira falta', () => {
    const absence = { id: 'a', typeName: 'Atestado', status: 'approved', startDate: '2026-10-06', endDate: '2026-10-07' };
    const covered = buildDayView({ date: '2026-10-06', today: '2026-10-19', shift, absences: [absence], markings: [] });
    assert.deepEqual(covered.incidents, []);
    assert.equal(covered.absence?.id, 'a');
    assert.equal(covered.balanceMinutes, null);
    assert.deepEqual(buildDayView({ date: '2026-10-06', today: '2026-10-19', shift, absences: [{ ...absence, status: 'rejected' }], markings: [] }).incidents, ['missing']);
    assert.deepEqual(buildDayView({ date: '2026-10-19', today: '2026-10-19', shift, absences: [], markings: [mark('2026-10-19', '09:57', 1)] }).incidents, []);
  });

  it('folga não tem falta e o mês usa o turno de trabalho quando há duas linhas no dia', () => {
    assert.deepEqual(buildDayView({ date: '2026-10-14', today: '2026-10-19', shift: { ...shift, type: 'day_off' }, absences: [], markings: [] }).incidents, []);
    const month = buildMonthView({ month: '2026-02', today: '2026-03-01', absences: [], markings: [],
      shifts: [{ ...shift, type: 'day_off', date: '2026-02-03' }, { ...shift, date: '2026-02-03' }] });
    assert.equal(month.length, 28);
    assert.equal(month[2].shift?.type, 'work');
  });

  it('ordena por instante e desempata pelo NSR', () => {
    const day = buildDayView({ date: '2026-10-19', today: '2026-10-20', shift, absences: [],
      markings: [mark('2026-10-19', '08:00', 12), mark('2026-10-19', '08:00', 11)] });
    assert.deepEqual(day.markings.map((item) => item.nsr), [11, 12]);
  });

  it('jornada que atravessa a meia-noite não gera aviso nem saldo', () => {
    const night = buildDayView({ date: '2026-10-10', today: '2026-10-19', shift: { ...shift, startTime: '22:00', endTime: '06:00', overnight: true }, absences: [], markings: [] });
    assert.deepEqual(night.incidents, []);
    assert.equal(night.balanceMinutes, null);
  });

  it('batida fora da unidade fixa da escala fica a conferir; no turno livre, não', () => {
    const marks = [mark('2026-10-16', '10:00', 1), mark('2026-10-16', '16:15', 2)].map((item) => ({ ...item, executionUnitId: 'outra' }));
    assert.ok(buildDayView({ date: '2026-10-16', today: '2026-10-19', shift: { ...shift, unitId: 'doca' }, absences: [], markings: marks }).incidents.includes('other_unit'));
    assert.ok(!buildDayView({ date: '2026-10-16', today: '2026-10-19', shift: { ...shift, unitId: 'doca', executionUnitPolicy: 'free' }, absences: [], markings: marks }).incidents.includes('other_unit'));
  });

  it('tolerância única da jornada: zera o saldo dentro dela, conta inteira acima; sem jornada, sem tolerância', () => {
    const inside = [mark('2026-10-12', '10:03', 1), mark('2026-10-12', '13:00', 2), mark('2026-10-12', '13:15', 3), mark('2026-10-12', '16:15', 4)];
    const day = buildDayView({ date: '2026-10-12', today: '2026-10-19', shift, absences: [], markings: inside });
    assert.equal(day.balanceMinutes, 0);
    assert.equal(day.deviation, null);
    const above = [mark('2026-10-12', '10:06', 1), mark('2026-10-12', '13:00', 2), mark('2026-10-12', '13:15', 3), mark('2026-10-12', '16:15', 4)];
    assert.equal(buildDayView({ date: '2026-10-12', today: '2026-10-19', shift, absences: [], markings: above }).balanceMinutes, -6);
    const withoutTolerance = buildDayView({ date: '2026-10-12', today: '2026-10-19', shift: { ...shift, toleranceMinutes: null }, absences: [], markings: inside });
    assert.equal(withoutTolerance.balanceMinutes, -3);
    assert.deepEqual(withoutTolerance.deviation, { edge: 'start', minutes: 3 });
  });

  it('intervalo fora da tolerância da jornada vira aviso; pausa mínima vale no intercalado', () => {
    const marks = [mark('2026-10-12', '10:00', 1), mark('2026-10-12', '13:00', 2), mark('2026-10-12', '13:40', 3), mark('2026-10-12', '16:15', 4)];
    assert.ok(buildDayView({ date: '2026-10-12', today: '2026-10-19', shift, absences: [], markings: marks }).incidents.includes('long_break'));
    const split = [mark('2026-10-12', '10:00', 1), mark('2026-10-12', '12:00', 2), mark('2026-10-12', '12:03', 3), mark('2026-10-12', '14:00', 4), mark('2026-10-12', '14:12', 5), mark('2026-10-12', '16:15', 6)];
    assert.ok(buildDayView({ date: '2026-10-12', today: '2026-10-19', shift: { ...shift, breakType: 'flexible', breakSplit: 'multiple', breakMinPauseMinutes: 5 }, absences: [], markings: split }).incidents.includes('short_break'));
  });

  it('dia em andamento soma até agora', () => {
    assert.equal(workedMinutes([{ markedAt: '2026-10-19T09:57:00-0300' }], 10 * 60 + 57), 60);
  });
});
