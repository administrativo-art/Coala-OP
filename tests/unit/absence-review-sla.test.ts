import assert from 'node:assert/strict';
import test from 'node:test';

import { createAbsenceReviewSla, isAbsenceReviewOverdue } from '../../src/features/dp/absences/requests/review-sla';

test('prazo de análise tem 24 horas corridas mesmo atravessando o dia', () => {
  const sla = createAbsenceReviewSla('2026-10-15T22:30:00.000Z');
  assert.deepEqual(sla, {
    hours: 24,
    startedAt: '2026-10-15T22:30:00.000Z',
    deadlineAt: '2026-10-16T22:30:00.000Z',
  });
});

test('prazo vence no instante final, sem decidir automaticamente a solicitação', () => {
  const sla = createAbsenceReviewSla('2026-10-15T10:00:00.000Z');
  assert.equal(isAbsenceReviewOverdue(sla, new Date('2026-10-16T09:59:59.999Z')), false);
  assert.equal(isAbsenceReviewOverdue(sla, new Date('2026-10-16T10:00:00.000Z')), true);
});
