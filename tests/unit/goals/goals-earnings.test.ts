import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_KIOSK_MEDIUM_GOAL_METHOD } from '../../../src/lib/goal-methods';
import { buildEmployeeEarnings, computeTrend, getPeriodBonus, reachedTier, summarizePrizes } from '../../../src/lib/goals-earnings';
import type { EmployeeGoal, GoalPeriodDoc } from '../../../src/types';

function period(id: string, extra: Partial<GoalPeriodDoc> = {}) {
  return { id, kioskId: 'k1', status: 'closed', targetValue: 1000, currentValue: 1000, ...extra } as unknown as GoalPeriodDoc;
}
function goal(periodId: string, employeeId: string, currentValue: number, targetValue: number, role?: string) {
  return { id: `${periodId}-${employeeId}-${currentValue}`, periodId, employeeId, currentValue, targetValue, participantRole: role } as unknown as EmployeeGoal;
}
const bonus = (participants: Array<{ employeeId: string; bonusAmount: number }>, totalPrize: number) =>
  ({ closureSnapshot: { bonus: { participants, totalPrize } }, goalMethodSnapshot: { type: 'tiered_unit_bonus' } }) as unknown as Partial<GoalPeriodDoc>;

test('soma premiação e faturamento por colaborador só de períodos encerrados', () => {
  const periods = [
    period('p1', bonus([{ employeeId: 'a', bonusAmount: 100 }, { employeeId: 'b', bonusAmount: 60 }], 160)),
    period('p2', bonus([{ employeeId: 'a', bonusAmount: 50 }], 50)),
    period('p3', { status: 'active' }),
  ];
  const goals = [goal('p1', 'a', 600, 500), goal('p1', 'b', 400, 500), goal('p2', 'a', 250, 500), goal('p3', 'a', 999, 500)];
  const rows = buildEmployeeEarnings(periods, goals);
  assert.deepEqual(rows.map(row => row.employeeId), ['a', 'b']);
  const a = rows[0]!;
  assert.equal(a.prize, 150);
  assert.equal(a.revenue, 850);
  assert.equal(a.periodCount, 2);
  assert.equal(a.prizedPeriodCount, 2);
  assert.equal(a.bestAttainment, 120);
  assert.equal(a.avgAttainment, 85);
});

test('turnos do mesmo colaborador no período contam como uma participação', () => {
  const rows = buildEmployeeEarnings([period('p1')], [goal('p1', 'a', 100, 200), goal('p1', 'a', 300, 200)]);
  assert.equal(rows[0]!.periodCount, 1);
  assert.equal(rows[0]!.avgAttainment, 100);
});

test('liderança prevalece como função do colaborador', () => {
  const rows = buildEmployeeEarnings([period('p1')], [goal('p1', 'a', 1, 1, 'fixed'), goal('p1', 'a', 1, 1, 'leader')]);
  assert.equal(rows[0]!.role, 'leader');
});

test('summarizePrizes separa gravados de pendentes', () => {
  const pending = period('p2', { goalMethodSnapshot: { type: 'tiered_unit_bonus' } } as unknown as Partial<GoalPeriodDoc>);
  const result = summarizePrizes([period('p1', bonus([], 160)), pending, period('p3')]);
  assert.deepEqual(result, { totalPrize: 160, recordedPrize: 160, calculatedPrize: 0, apuratedCount: 1, calculatedCount: 0, pendingCount: 1 });
});

test('período encerrado sem apuração gravada é calculado pela regra do método', () => {
  const legacy = period('p1', {
    currentValue: 31261,
    goalMethodSnapshot: DEFAULT_KIOSK_MEDIUM_GOAL_METHOD,
    shifts: [{ id: 'period', label: 'Mensal', fraction: 1 }],
    closureSnapshot: { periodDayCount: 31 },
  } as unknown as Partial<GoalPeriodDoc>);
  const goals = [goal('p1', 'lider', 0, 0, 'leader'), goal('p1', 'a', 10000, 10000, 'fixed'), goal('p1', 'b', 10000, 10000, 'fixed')]
    .map(g => ({ ...g, scheduledTurnCount: g.employeeId === 'lider' ? 4 : 24 }) as EmployeeGoal);

  const result = getPeriodBonus(legacy, goals);
  assert.ok(result);
  assert.equal(result.calculated, true);
  assert.equal(result.bonus.totalPrize, 374.51);

  const rows = buildEmployeeEarnings([legacy], goals);
  assert.equal(rows.find(row => row.employeeId === 'a')!.prize, 140.44);
  assert.equal(rows.find(row => row.employeeId === 'a')!.prizeCalculated, 140.44);

  const totals = summarizePrizes([legacy], goals);
  assert.equal(totals.calculatedCount, 1);
  assert.equal(totals.calculatedPrize, 374.51);
  assert.equal(totals.pendingCount, 0);
});

test('tendência compara as últimas 3 metas com as 3 anteriores', () => {
  assert.equal(computeTrend([80, 90]), null);
  assert.equal(computeTrend([70, 70, 70, 80, 80, 80]), 10);
  assert.equal(computeTrend([100, 80, 80, 80]), -20);
});

test('faixa alcançada segue alvo, UP e TOP do período', () => {
  const base = { targetValue: 100, upValue: 120, topValue: 150 };
  assert.equal(reachedTier({ ...base, currentValue: 99 }), 'below');
  assert.equal(reachedTier({ ...base, currentValue: 100 }), 'target');
  assert.equal(reachedTier({ ...base, currentValue: 125 }), 'up');
  assert.equal(reachedTier({ ...base, currentValue: 150 }), 'top');
  assert.equal(reachedTier({ targetValue: 100, upValue: 0, topValue: undefined, currentValue: 130 }), 'target');
});
