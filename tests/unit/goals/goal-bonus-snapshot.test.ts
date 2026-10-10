import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_KIOSK_MEDIUM_GOAL_METHOD } from '../../../src/lib/goal-methods';
import { buildGoalClosureBonusSnapshot } from '../../../src/lib/goal-bonus-snapshot';
import type { EmployeeGoal, GoalMethodSnapshot } from '../../../src/types';

const method: GoalMethodSnapshot = DEFAULT_KIOSK_MEDIUM_GOAL_METHOD;

function goal(employeeId: string, role: 'fixed' | 'relief' | 'leader', turns: number): EmployeeGoal {
  return { id: `g-${employeeId}`, periodId: 'p', employeeId, kioskId: 'k', participantRole: role, scheduledTurnCount: turns } as EmployeeGoal;
}

const period = (currentValue: number) => ({ currentValue, goalMethodSnapshot: method, shifts: [{ id: 'period', label: 'Mensal', fraction: 1 }] });

test('agosto/2026 Tirirical: fixo de R$ 100 + 8% do excedente, dividido entre 2 fixas', () => {
  const result = buildGoalClosureBonusSnapshot({
    period: period(31261),
    employeeGoals: [goal('lider', 'leader', 4), goal('a', 'fixed', 24), goal('b', 'fixed', 24)],
    periodDayCount: 31,
    source: 'backfill',
  });
  assert.ok(result);
  assert.equal(result.highestTierId, 'target');
  assert.equal(result.fixedTotal, 100);
  assert.equal(result.totalTeamBonus, 280.88);
  assert.equal(result.leadershipBonus, 93.63);
  assert.equal(result.totalPrize, 374.51);
  assert.deepEqual(result.participants.map(p => p.bonusAmount), [93.63, 140.44, 140.44]);
});

test('setembro/2026 Tirirical: folguista recebe pelos turnos cobertos', () => {
  const result = buildGoalClosureBonusSnapshot({
    period: period(29465.5),
    employeeGoals: [goal('lider', 'leader', 3), goal('a', 'fixed', 24), goal('b', 'fixed', 24), goal('r', 'relief', 8)],
    periodDayCount: 30,
    source: 'closure',
  });
  assert.ok(result);
  assert.equal(result.totalTeamBonus, 137.24);
  assert.equal(result.totalPeriodTurns, 60);
  const byId = Object.fromEntries(result.participants.map(p => [p.employeeId, p.bonusAmount]));
  assert.equal(byId.r, 18.3);
  assert.equal(byId.a, 59.47);
  assert.equal(byId.lider, 45.75);
});

test('abaixo da Meta Alvo não paga nem o fixo', () => {
  const result = buildGoalClosureBonusSnapshot({
    period: period(21334),
    employeeGoals: [goal('a', 'fixed', 24)],
    periodDayCount: 30,
    source: 'closure',
  });
  assert.ok(result);
  assert.equal(result.highestTierId, null);
  assert.equal(result.totalPrize, 0);
});

test('método sem faixas não gera apuração', () => {
  assert.equal(
    buildGoalClosureBonusSnapshot({ period: { currentValue: 1, shifts: [] }, employeeGoals: [], periodDayCount: 30, source: 'closure' }),
    null
  );
});
