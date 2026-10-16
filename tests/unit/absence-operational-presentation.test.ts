import assert from 'node:assert/strict';
import test from 'node:test';

import { availableOperationalActions, isOperationalPending, operationalPresentation } from '../../src/features/dp/absences/requests/operational-presentation';
import type { AbsenceRequestDto } from '../../src/features/dp/absences/requests/workflow-types';

type Operational = NonNullable<AbsenceRequestDto['operational']>;
function value(state: Operational['state'], flags: Partial<Operational> = {}): Operational {
  return { state, operationallyApplied: false, canReconcile: false, canAbortPreparation: false, ...flags };
}

test('todos os estados distinguem decisão e aplicação operacional', () => {
  assert.match(operationalPresentation(value('preparing')).label, /Preparação/);
  assert.match(operationalPresentation(value('activation_pending')).detail, /ainda não foi confirmado/);
  assert.match(operationalPresentation(value('active', { operationallyApplied: true })).label, /ativo/);
  assert.match(operationalPresentation(value('reversal_pending')).label, /pendente/);
  assert.match(operationalPresentation(value('reversed')).label, /revertido/);
  assert.equal(isOperationalPending(value('preparing')), true);
  assert.equal(isOperationalPending(value('activation_pending')), true);
  assert.equal(isOperationalPending(value('reversal_pending')), true);
  assert.equal(isOperationalPending(value('active', { operationallyApplied: true })), false);
});

test('pedido aprovado pendente não declara aplicação e capacidade não autoriza aborto sozinha', () => {
  assert.doesNotMatch(operationalPresentation(value('activation_pending')).label, /ativo|aplicado/i);
  assert.deepEqual(availableOperationalActions(value('preparing')), { abort: false, activate: false, reverse: false });
  assert.equal(availableOperationalActions(value('preparing', { canAbortPreparation: true })).abort, true);
  assert.equal(availableOperationalActions(value('active', { canReconcile: true, canAbortPreparation: true })).abort, false);
  assert.equal(availableOperationalActions(value('activation_pending', { canReconcile: true })).activate, true);
  assert.equal(availableOperationalActions(value('reversal_pending', { canReconcile: true })).reverse, true);
  assert.match(operationalPresentation(value('active')).label, /não confirmada/i);
});
