import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_KIOSK_MEDIUM_GOAL_METHOD } from '../../../src/lib/goal-methods';
import { buildGoalClosureBonusSnapshot, countGoalScheduledWork } from '../../../src/lib/goal-bonus-snapshot';
import type { EmployeeGoal, GoalMethodSnapshot } from '../../../src/types';

const method: GoalMethodSnapshot = DEFAULT_KIOSK_MEDIUM_GOAL_METHOD;

function goal(employeeId: string, role: 'fixed' | 'relief' | 'leader', turns: number): EmployeeGoal {
  return { id: `g-${employeeId}`, periodId: 'p', employeeId, kioskId: 'k', participantRole: role, scheduledTurnCount: turns } as EmployeeGoal;
}

const period = (currentValue: number) => ({ currentValue, goalMethodSnapshot: method, shifts: [{ id: 'period', label: 'Mensal', fraction: 1 }] });

test('fechamento conta dias e turnos atuais do grupo mensal sem horário', () => {
  const work = countGoalScheduledWork({ employeeId: 'r', shiftId: 'period' }, period(30000), [
    { userId: 'r', date: '2026-10-01', startTime: '08:00', endTime: '14:00' },
    { userId: 'r', date: '2026-10-01', startTime: '14:00', endTime: '20:00' },
    { userId: 'r', date: '2026-10-02', startTime: '08:00', endTime: '14:00' },
    { userId: 'a', date: '2026-10-03', startTime: '08:00', endTime: '14:00' },
  ]);
  assert.deepEqual(work, { dates: ['2026-10-01', '2026-10-02'], turns: 3 });
});

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
    period: { ...period(29465.5), startDate: '2026-09-01' },
    employeeGoals: [goal('lider', 'leader', 3), goal('a', 'fixed', 24), goal('b', 'fixed', 24), goal('r', 'relief', 8)],
    periodDayCount: 30,
    source: 'closure',
  });
  assert.ok(result);
  assert.equal(result.totalTeamBonus, 137.24);
  assert.equal(result.reliefBasis, 'turns');
  assert.equal(result.totalPeriodTurns, 60);
  const byId = Object.fromEntries(result.participants.map(p => [p.employeeId, p.bonusAmount]));
  assert.equal(byId.r, 18.3);
  assert.equal(byId.a, 59.47);
  assert.equal(byId.lider, 45.75);
});

test('novembro/2026: folguista recebe por dias distintos da escala vigente', () => {
  const result = buildGoalClosureBonusSnapshot({
    period: { ...period(30643.5), startDate: '2026-11-01' },
    employeeGoals: [goal('lider', 'leader', 5), goal('a', 'fixed', 24), goal('b', 'fixed', 24), goal('r', 'relief', 8)],
    workedDaysByEmployeeId: { r: 5 },
    periodDayCount: 30,
    source: 'closure',
  });
  assert.ok(result);
  assert.equal(result.reliefBasis, 'days');
  assert.equal(result.totalPeriodDays, 30);
  assert.equal(result.totalTeamBonus, 231.48);
  const byId = Object.fromEntries(result.participants.map(p => [p.employeeId, p.bonusAmount]));
  assert.equal(byId.r, 38.58);
  assert.equal(byId.a, 96.45);
  assert.equal(byId.b, 96.45);
  assert.equal(byId.lider, 77.16);
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
