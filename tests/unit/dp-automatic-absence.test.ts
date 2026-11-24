import assert from 'node:assert/strict';
import test from 'node:test';

import { adjustmentRestoresAutomaticAbsence, automaticAbsenceDeadline, automaticAbsenceSuperseded } from '../../src/features/dp/time-adjustments/automatic-absence-core';

test('falta automática vence 24 horas depois do fim civil do turno', () => {
  assert.deepEqual(automaticAbsenceDeadline('2026-10-22', '09:00', '18:00', false, 'America/Belem'), {
    shiftEndAt: '2026-10-22T18:00:00-0300', dueAt: '2026-10-23T21:00:00.000Z',
  });
  assert.deepEqual(automaticAbsenceDeadline('2026-10-22', '22:00', '07:00', true, 'America/Manaus'), {
    shiftEndAt: '2026-10-23T07:00:00-0400', dueAt: '2026-10-24T11:00:00.000Z',
  });
});

test('ajuste ou ausência aprovados substituem a falta sem apagar seu histórico', () => {
  assert.equal(automaticAbsenceSuperseded('2026-10-22', new Set(['2026-10-22']), []), true);
  assert.equal(automaticAbsenceSuperseded('2026-10-22', new Set(), [{ startDate: '2026-10-21', endDate: '2026-10-23' }]), true);
  assert.equal(automaticAbsenceSuperseded('2026-10-22', new Set(), []), false);
});

test('somente ajuste aprovado com batida incluída anula a falta automática', () => {
  assert.equal(adjustmentRestoresAutomaticAbsence({ status: 'approved', kind: 'discard', inclusion: null }), false);
  assert.equal(adjustmentRestoresAutomaticAbsence({ status: 'in_review', kind: 'include', inclusion: { markedAt: '2026-11-10T09:00:00-0300' } }), false);
  assert.equal(adjustmentRestoresAutomaticAbsence({ status: 'approved', kind: 'correct', inclusion: { markedAt: '2026-11-10T09:00:00-0300' } }), true);
});
