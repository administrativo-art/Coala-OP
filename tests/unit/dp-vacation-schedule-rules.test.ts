import assert from 'node:assert/strict';
import test from 'node:test';

import type { DPVacationRecord } from '../../src/types';
import {
  buildApprovedVacationIndex,
  findApprovedVacationForDate,
  findApprovedVacationInIndex,
  formatVacationPeriod,
  isApprovedVacationPeriod,
  vacationQueryWindow,
} from '../../src/lib/dp-vacation-schedule-rules';

function vacation(overrides: Partial<DPVacationRecord> = {}): DPVacationRecord {
  return {
    id: 'vacation-1',
    userId: 'maria-joana',
    cycleId: '2024-2025',
    recordType: 'gozo',
    startDate: '2026-09-02',
    endDate: '2026-09-06',
    days: 5,
    status: 'APPROVED',
    warnings: [],
    createdAt: {} as DPVacationRecord['createdAt'],
    ...overrides,
  };
}

test('identifica todos os dias do período aprovado de gozo, incluindo as extremidades', () => {
  const records = [vacation()];

  assert.equal(findApprovedVacationForDate(records, 'maria-joana', '2026-09-01'), null);
  assert.equal(findApprovedVacationForDate(records, 'maria-joana', '2026-09-02')?.id, 'vacation-1');
  assert.equal(findApprovedVacationForDate(records, 'maria-joana', '2026-09-04')?.id, 'vacation-1');
  assert.equal(findApprovedVacationForDate(records, 'maria-joana', '2026-09-06')?.id, 'vacation-1');
  assert.equal(findApprovedVacationForDate(records, 'maria-joana', '2026-09-07'), null);
});

test('não bloqueia a escala por férias pendentes, rejeitadas, planejadas ou vendidas', () => {
  const records = [
    vacation({ id: 'pending', status: 'PENDING' }),
    vacation({ id: 'planned', status: 'PLANNED' }),
    vacation({ id: 'rejected', status: 'REJECTED' }),
    vacation({ id: 'sale', recordType: 'venda' }),
  ];

  assert.equal(findApprovedVacationForDate(records, 'maria-joana', '2026-09-04'), null);
});

test('ignora período inválido em vez de bloquear datas indevidas', () => {
  assert.equal(isApprovedVacationPeriod(vacation({ startDate: '2026-02-30' })), false);
  assert.equal(isApprovedVacationPeriod(vacation({ startDate: '2026-09-07', endDate: '2026-09-06' })), false);
  assert.equal(findApprovedVacationForDate([vacation()], 'outra-pessoa', '2026-09-04'), null);
});

test('formata o período para a mensagem da escala', () => {
  assert.equal(formatVacationPeriod(vacation()), '02/09/2026 a 06/09/2026');
});

test('índice agrupa somente períodos aprovados para consulta repetida pela escala', () => {
  const index = buildApprovedVacationIndex([
    vacation({ id: 'later', startDate: '2026-12-01', endDate: '2026-12-05' }),
    vacation({ id: 'current' }),
    vacation({ id: 'ignored', status: 'PLANNED' }),
  ]);

  assert.deepEqual(index.get('maria-joana')?.map((item) => item.id), ['current', 'later']);
  assert.equal(findApprovedVacationInIndex(index, 'maria-joana', '2026-09-03')?.id, 'current');
});

test('janela da consulta cobre o mês da escala e férias que terminam no mês seguinte', () => {
  assert.deepEqual(vacationQueryWindow(2026, 9), {
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
    queryEnd: '2026-10-31',
  });
  assert.deepEqual(vacationQueryWindow(2026, 12), {
    monthStart: '2026-12-01',
    monthEnd: '2026-12-31',
    queryEnd: '2027-01-31',
  });
});
