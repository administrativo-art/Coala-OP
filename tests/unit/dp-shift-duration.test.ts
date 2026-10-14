import assert from 'node:assert/strict';
import test from 'node:test';

import { formatShiftMinutes, shiftDurationSummary, shiftJourneyComparisons } from '../../src/lib/dp-shift-duration';

test('expediente definido desconta o intervalo fixo da faixa do turno', () => {
  assert.deepEqual(shiftDurationSummary({
    startTime: '09:00',
    endTime: '15:00',
    breakType: 'fixed',
    breakStart: '12:00',
    breakEnd: '12:15',
  }), {
    grossMinutes: 360,
    breakMinutes: 15,
    workedMinutes: 345,
  });
  assert.equal(formatShiftMinutes(345), '5h45');
  assert.equal(formatShiftMinutes(360), '6h');
});

test('expediente definido suporta intervalo por duração e turno noturno', () => {
  assert.deepEqual(shiftDurationSummary({
    startTime: '22:00',
    endTime: '06:00',
    overnight: true,
    breakType: 'flexible',
    breakDurationMinutes: 60,
  }), {
    grossMinutes: 480,
    breakMinutes: 60,
    workedMinutes: 420,
  });
});

test('expediente esperado parte do início do turno e usa a carga diária da jornada', () => {
  const [comparison] = shiftJourneyComparisons({
    startTime: '08:00',
    endTime: '14:00',
    breakType: 'fixed',
    breakStart: '11:45',
    breakEnd: '12:00',
  }, {
    days: [
      { dayIndex: 1, plannedMinutes: 440, isRestDay: false },
      { dayIndex: 2, plannedMinutes: 0, isRestDay: true },
    ],
  });

  assert.deepEqual(comparison, {
    defined: { grossMinutes: 360, breakMinutes: 15, workedMinutes: 345 },
    expectedStartTime: '08:00',
    expectedEndTime: '16:20',
    expectedOvernight: false,
    expectedWorkMinutes: 440,
    expectedBreakMinutes: 60,
    expectedGrossMinutes: 500,
    endsBeforeExpected: true,
  });
});
