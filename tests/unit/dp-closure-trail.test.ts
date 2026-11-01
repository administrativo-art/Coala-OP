import assert from 'node:assert/strict';
import test from 'node:test';

import { dayNeedsTreatment } from '../../src/features/dp/time-adjustments/closure-focus-mode';
import { pendingOfPerson } from '../../src/features/dp/time-adjustments/closure-year-overview';
import type { DayView } from '../../src/features/dp/rep-p/day-model';
import type { AdjustmentView } from '../../src/features/dp/time-adjustments/types';

const day = (date: string, extra: Partial<DayView> = {}) => ({ date, shift: null, markings: [], allMarkings: [], absence: null, incidents: [],
  workedMinutes: 0, breakMinutes: null, plannedWorkMinutes: null, nightMinutes: 0, balanceMinutes: null, deviation: null, ...extra }) as DayView;
const adjustment = (workDate: string, status: AdjustmentView['status']) => ({ workDate, status }) as AdjustmentView;

test('dia a tratar no saneamento: alerta, ajuste em análise ou ausência sem decisão; nunca hoje ou futuro', () => {
  const today = '2026-11-01';
  assert.equal(dayNeedsTreatment(day('2026-10-30', { incidents: ['missing'] }), [], today), true);
  assert.equal(dayNeedsTreatment(day('2026-10-29'), [adjustment('2026-10-29', 'in_review')], today), true);
  assert.equal(dayNeedsTreatment(day('2026-10-29'), [adjustment('2026-10-29', 'approved')], today), false);
  assert.equal(dayNeedsTreatment(day('2026-10-28', { absence: { id: 'a', typeName: 'Atestado', status: 'in_review', startDate: '2026-10-28', endDate: '2026-10-28' } }), [], today), true);
  assert.equal(dayNeedsTreatment(day('2026-10-28', { absence: { id: 'a', typeName: 'Atestado', status: 'approved', startDate: '2026-10-28', endDate: '2026-10-28' } }), [], today), false);
  assert.equal(dayNeedsTreatment(day('2026-11-01', { incidents: ['missing'] }), [], today), false);
  assert.equal(dayNeedsTreatment(day('2026-10-27'), [], today), false);
});

test('pendências de uma pessoa somam só pedidos sem decisão (ajuste, ausência e troca)', () => {
  const person = {
    uid: 'u', name: 'Pessoa',
    adjustments: [{ status: 'in_review' }, { status: 'approved' }],
    absences: [{ status: 'submitted' }, { status: 'adjustments_requested' }, { status: 'approved' }, { status: 'rejected' }],
    shiftSwaps: [{ status: 'pending' }, { status: 'accepted' }],
  } as never;
  assert.equal(pendingOfPerson(person), 4);
});

test('ausência só cobre o dia sem batida quando é de dia inteiro, carregada e válida', async () => {
  const { absenceCoverage } = await import('../../src/features/dp/time-adjustments/closure-focus-mode');
  const dayAbsence = { id: 'a', typeName: 'Atestado', status: 'in_review', startDate: '2026-10-30', endDate: '2026-10-30' };
  // Pedido ainda carregando ou ilegível: o alerta continua.
  assert.equal(absenceCoverage(dayAbsence, null).covers('missing'), false);
  // Ausência por horas não cobre o dia.
  assert.equal(absenceCoverage(dayAbsence, { unit: 'hour', status: 'in_review' }).covers('missing'), false);
  // Dia inteiro em análise cobre o alerta, mas não afirma que nenhuma batida era esperada.
  const pending = absenceCoverage(dayAbsence, { unit: 'day', status: 'in_review' });
  assert.equal(pending.covers('missing'), true);
  assert.equal(pending.covers('odd'), true);
  assert.equal(pending.covers('short_break'), false);
  assert.equal(pending.approved, false);
  assert.equal(absenceCoverage(dayAbsence, { unit: 'day', status: 'approved' }).approved, true);
  // Recusada ou cancelada não cobre nada.
  assert.equal(absenceCoverage(dayAbsence, { unit: 'day', status: 'rejected' }).covers('missing'), false);
  assert.equal(absenceCoverage(null, { unit: 'day', status: 'approved' }).covers('missing'), false);
});
