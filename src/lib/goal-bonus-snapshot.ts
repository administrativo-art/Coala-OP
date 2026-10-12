import { calculateTieredGoalBonus } from '@/lib/goal-methods';
import type { EmployeeGoal, GoalClosureBonusSnapshot, GoalParticipantRole, GoalPeriodDoc } from '@/types';

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function resolveRole(goals: EmployeeGoal[]): GoalParticipantRole {
  if (goals.some(goal => goal.participantRole === 'leader')) return 'leader';
  if (goals.some(goal => goal.participantRole === 'relief')) return 'relief';
  return 'fixed';
}

/**
 * Apura a premiação do período com a mesma regra do painel de Acompanhamento
 * (calculateTieredGoalBonus + rateio equipe/folguista/liderança).
 * Retorna null quando o período não usa o método por faixas.
 */
export function buildGoalClosureBonusSnapshot(params: {
  period: Pick<GoalPeriodDoc, 'currentValue' | 'goalMethodSnapshot' | 'shifts'>;
  employeeGoals: EmployeeGoal[];
  periodDayCount: number;
  source: GoalClosureBonusSnapshot['source'];
}): GoalClosureBonusSnapshot | null {
  const { period, employeeGoals, periodDayCount, source } = params;
  const method = period.goalMethodSnapshot;
  if (!method || method.type !== 'tiered_unit_bonus') return null;

  const goalsByEmployee = new Map<string, EmployeeGoal[]>();
  for (const goal of employeeGoals) {
    const bucket = goalsByEmployee.get(goal.employeeId);
    if (bucket) bucket.push(goal);
    else goalsByEmployee.set(goal.employeeId, [goal]);
  }

  const rows = [...goalsByEmployee.entries()].map(([employeeId, goals]) => ({
    employeeId,
    role: resolveRole(goals),
    scheduledTurns: goals.reduce((sum, goal) => sum + (goal.scheduledTurnCount ?? 0), 0),
  }));
  const bonusRows = rows.filter(row => row.role !== 'leader');
  const fixedRows = bonusRows.filter(row => row.role !== 'relief');
  const reliefRows = bonusRows.filter(row => row.role === 'relief');

  const turnsPerDay = Math.max(method.teamBonus.reliefWorker?.turnsPerDay ?? period.shifts?.length ?? 1, 1);
  const totalPeriodTurns = Math.max(periodDayCount, 1) * turnsPerDay;

  const result = calculateTieredGoalBonus(method, period.currentValue ?? 0, bonusRows.length, {
    fixedCollaboratorCount: fixedRows.length,
    reliefWorkerCount: reliefRows.length,
    reliefWorkerCoveredTurnsByPerson: reliefRows.map(row => row.scheduledTurns),
    totalPeriodTurns,
  });
  if (!result) return null;

  const reliefBonusByEmployee = new Map(
    reliefRows.map((row, index) => [
      row.employeeId,
      result.reliefWorkerSplit?.reliefWorkerBonuses[index] ?? result.perCollaboratorBonus,
    ])
  );

  const participants = rows.map(row => ({
    employeeId: row.employeeId,
    role: row.role,
    scheduledTurns: row.scheduledTurns,
    bonusAmount:
      row.role === 'leader'
        ? result.leadershipBonus
        : row.role === 'relief'
          ? reliefBonusByEmployee.get(row.employeeId) ?? result.perCollaboratorBonus
          : result.reliefWorkerSplit?.perFixedCollaboratorBonus ?? result.perCollaboratorBonus,
  }));

  const tiers = result.achievedTiers.map(item => ({
    tierId: item.tier.id,
    label: item.tier.label,
    fixedBonusAmount: item.fixedBonusAmount,
    excessAmount: item.excessAmount,
    variableBonusAmount: item.variableBonusAmount,
    totalBonusAmount: item.totalBonusAmount,
  }));

  return {
    version: 1,
    source,
    methodId: method.id,
    methodName: method.name,
    revenue: result.revenue,
    highestTierId: result.highestAchievedTier?.id ?? null,
    highestTierLabel: result.highestAchievedTier?.label ?? null,
    tiers,
    fixedTotal: roundMoney(tiers.reduce((sum, item) => sum + item.fixedBonusAmount, 0)),
    variableTotal: roundMoney(tiers.reduce((sum, item) => sum + item.variableBonusAmount, 0)),
    totalTeamBonus: result.totalTeamBonus,
    leadershipBonus: result.leadershipBonus,
    totalPrize: roundMoney(result.totalTeamBonus + result.leadershipBonus),
    totalPeriodTurns,
    participants,
  };
}
