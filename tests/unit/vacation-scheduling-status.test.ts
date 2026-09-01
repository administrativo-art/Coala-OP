import assert from 'node:assert/strict';
import test from 'node:test';

import type { DPVacationRecord, DPVacationStatus } from '../../src/types';
import {
  calculateVacationHealth,
  getCycleRisk,
  getVacationCycleHistory,
} from '../../src/lib/utils/vacation-logic';

const admission = new Date(2024, 8, 11);
const referenceDate = new Date(2026, 8, 1);
const cycleId = '2024-2025';

function record(params: {
  id: string;
  days: number;
  startDate: string;
  endDate: string;
  status?: DPVacationStatus;
}): DPVacationRecord {
  return {
    id: params.id,
    userId: 'employee-1',
    cycleId,
    recordType: 'gozo',
    days: params.days,
    status: params.status ?? 'APPROVED',
    startDate: params.startDate,
    endDate: params.endDate,
    warnings: [],
    createdAt: {} as DPVacationRecord['createdAt'],
  };
}

const approvedSchedule = [
  record({ id: 'a', days: 15, startDate: '2025-12-02', endDate: '2025-12-16' }),
  record({ id: 'b', days: 5, startDate: '2026-02-09', endDate: '2026-02-13' }),
  record({ id: 'c', days: 5, startDate: '2026-06-10', endDate: '2026-06-14' }),
  record({ id: 'd', days: 5, startDate: '2026-09-02', endDate: '2026-09-06' }),
];

test('ciclo completo e aprovado fica agendado, sem criticidade por proximidade', () => {
  const cycle = getVacationCycleHistory(admission, approvedSchedule, referenceDate)
    .find(item => item.id === cycleId);
  assert.ok(cycle);
  assert.equal(cycle.status, 'AGENDADO');
  assert.equal(cycle.balance, 0);
  assert.equal(getCycleRisk(cycle, referenceDate), 'EM_DIA');

  const health = calculateVacationHealth(admission, approvedSchedule, referenceDate);
  assert.equal(health.status, 'CONCESSIVO');
  if (health.status === 'CONCESSIVO') {
    assert.equal(health.cycleStatus, 'AGENDADO');
    assert.equal(health.details.risk, 'EM_DIA');
  }
});

test('trinta dias lançados com registro ainda não aprovado aguardam aprovação', () => {
  const pending = approvedSchedule.map(item => item.id === 'd' ? { ...item, status: 'PLANNED' as const } : item);
  const cycle = getVacationCycleHistory(admission, pending, referenceDate)
    .find(item => item.id === cycleId);
  assert.ok(cycle);
  assert.equal(cycle.status, 'AGUARDANDO_APROVACAO');
  assert.equal(cycle.balance, 0);
});

test('saldo ainda não distribuído permanece parcial e crítico perto do prazo', () => {
  const cycle = getVacationCycleHistory(admission, approvedSchedule.slice(0, 3), referenceDate)
    .find(item => item.id === cycleId);
  assert.ok(cycle);
  assert.equal(cycle.status, 'PARCIAL');
  assert.equal(cycle.balance, 5);
  assert.equal(getCycleRisk(cycle, referenceDate), 'CRITICA');
});

test('registro rejeitado não reduz o saldo do ciclo', () => {
  const rejected = { ...approvedSchedule[3], status: 'REJECTED' as const };
  const cycle = getVacationCycleHistory(admission, [...approvedSchedule.slice(0, 3), rejected], referenceDate)
    .find(item => item.id === cycleId);
  assert.ok(cycle);
  assert.equal(cycle.status, 'PARCIAL');
  assert.equal(cycle.balance, 5);
});

test('período aprovado que termina depois do concessivo fica vencido', () => {
  const outsideDeadline = approvedSchedule.map(item => item.id === 'd'
    ? { ...item, startDate: '2026-09-07', endDate: '2026-09-11' }
    : item);
  const cycle = getVacationCycleHistory(admission, outsideDeadline, referenceDate)
    .find(item => item.id === cycleId);
  assert.ok(cycle);
  assert.equal(cycle.status, 'VENCIDO');
  assert.equal(getCycleRisk(cycle, referenceDate), 'VENCIDA');
});

test('ciclo vira concluído depois que o último gozo aprovado termina', () => {
  const afterLastPeriod = new Date(2026, 8, 7);
  const cycle = getVacationCycleHistory(admission, approvedSchedule, afterLastPeriod)
    .find(item => item.id === cycleId);
  assert.ok(cycle);
  assert.equal(cycle.status, 'GOZADO');
});
