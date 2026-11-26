import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDayView, type DayShift } from '../../src/features/dp/rep-p/day-model';

// Líder na Política de jornada de cobertura: turno de 6h (09:00–15:15, 15 min), carga da jornada 8h, tolerância 5.
const coverage: DayShift = { type: 'work', startTime: '09:00', endTime: '15:15', shiftName: 'CS - 01 AT | Manhã', unitName: 'Tirirical',
  breakType: 'fixed', breakStart: '12:00', breakEnd: '12:15', breakDurationMinutes: 15, breakWindowStart: null, breakWindowEnd: null,
  expectedPunches: 4, toleranceMinutes: 5, unitId: 'u', coverage: true, referenceMinutes: 480 };
const attendant: DayShift = { ...coverage, coverage: undefined };
const day = (shift: DayShift, ...times: string[]) => buildDayView({ date: '2026-12-01', today: '2026-12-02', shift, absences: [],
  markings: times.map((time, index) => ({ receiptId: `r${index}`, markedAt: `2026-12-01T${time}:00-0300`, nsr: index + 1,
    executionUnitId: 'u', receiptStatus: 'available' as const })) });

describe('Política de jornada de cobertura no dia', () => {
  it('cumpriu as 6h do turno: nada a revisar, saldo do dia zero, mostra até quando pode estender', () => {
    const result = day(coverage, '09:00', '12:00', '12:15', '15:15');
    assert.deepEqual(result.incidents, []);
    assert.equal(result.balanceMinutes, 0);
    assert.equal(result.extendUntil, '18:00');
  });

  it('estendeu até completar 8h com 1h de intervalo: sem "Saída após o previsto" e sem saldo no dia', () => {
    const result = day(coverage, '09:00', '12:00', '13:00', '18:00');
    assert.equal(result.workedMinutes, 480);
    assert.deepEqual(result.incidents, []);
    assert.equal(result.balanceMinutes, 0);
    assert.equal(result.deviation, null);
  });

  it('a tolerância vale na saída pela carga: 8h03 fica sem ocorrência; 8h06 é saída após o previsto', () => {
    assert.deepEqual(day(coverage, '09:00', '12:00', '13:00', '18:03').incidents, []);
    const over = day(coverage, '09:00', '12:00', '13:00', '18:06');
    assert.deepEqual(over.incidents, ['late_exit']);
    assert.equal(over.balanceMinutes, 6);
  });

  it('passou de 6h com intervalo menor que 1h: intervalo insuficiente (grave)', () => {
    const result = day(coverage, '09:00', '12:00', '12:15', '17:00');
    assert.ok(result.incidents.includes('short_break'));
    assert.equal(result.expectedBreakMinutes, 60);
  });

  it('sem fracionamento no turno, a 1h precisa ser uma pausa só; com fracionamento, a soma vale', () => {
    const split = ['09:00', '12:00', '12:15', '15:00', '15:45', '18:00'];
    assert.ok(day(coverage, ...split).incidents.includes('short_break'));
    assert.ok(!day({ ...coverage, breakSplit: 'multiple' }, ...split).incidents.includes('short_break'));
  });

  it('intervalo de 1h05 acima de 6h: maior que o previsto (sem tolerância no intervalo)', () => {
    assert.deepEqual(day(coverage, '09:00', '12:00', '13:05', '17:30').incidents, ['long_break']);
  });

  it('saiu antes do fim do turno: saída antes do fim da cobertura (grave); débito no dia contra o turno', () => {
    const result = day(coverage, '09:00', '12:00', '12:15', '14:30');
    assert.deepEqual(result.incidents, ['coverage_early_exit']);
    assert.equal(result.balanceMinutes, -45);
  });

  it('chegou depois do início além da tolerância: entrada após o previsto (leve)', () => {
    assert.deepEqual(day(coverage, '09:10', '12:00', '12:15', '15:15').incidents, ['late_start']);
  });

  it('fora da política (atendente), ficar até 18:00 continua "Saída após o previsto"; sair cedo é leve', () => {
    const late = day(attendant, '09:00', '12:00', '12:15', '18:00');
    assert.deepEqual(late.incidents, ['late_exit']);
    assert.equal(late.extendUntil, null);
    assert.deepEqual(day(attendant, '09:00', '12:00', '12:15', '14:30').incidents, ['early_exit']);
  });

  it('dia manual prevalece: com segmentos manuais a cobertura não se aplica', () => {
    const manual = { ...coverage, manualOrder: 1, manualMode: 'fixed' as const };
    const result = buildDayView({ date: '2026-12-01', today: '2026-12-02', shift: coverage, shifts: [manual], absences: [],
      markings: [] });
    assert.equal(result.extendUntil, null);
  });
});
