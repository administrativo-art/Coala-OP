import { calculateTieredGoalBonus } from "@/lib/goal-methods";
import type { EmployeeGoal, GoalMethodSnapshot, GoalParticipantRole, GoalType } from "@/types";

/** Plain view of a goal period: dates as day keys, so the math does not depend on Firestore types. */
export type MobileGoalPeriodInput = {
  id: string;
  type: GoalType;
  startKey: string;
  endKey: string;
  targetValue: number;
  upValue?: number;
  topValue?: number;
  currentValue: number;
  dailyProgress: Record<string, number>;
  shiftCount: number;
  method: GoalMethodSnapshot | null;
  /**
   * Days the goal is distributed over when the period uses "scheduled days" (from the unit's
   * schedule). Absent or empty means calendar days, the rule and the fallback of the web panel.
   */
  activeDays?: string[];
};

const DAY_MS = 86_400_000;
const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const keyToTime = (key: string) => Date.parse(`${key}T12:00:00.000Z`);
const timeToKey = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Calendar days of the period, used for the prize turns and when the goal is not distributed by schedule. */
export function goalDistributionDays(period: Pick<MobileGoalPeriodInput, "startKey" | "endKey" | "activeDays">) {
  const scheduled = (period.activeDays ?? []).filter((key) => key >= period.startKey && key <= period.endKey);
  return scheduled.length ? [...new Set(scheduled)].sort() : dayKeysBetween(period.startKey, period.endKey);
}

export function dayKeysBetween(startKey: string, endKey: string) {
  const keys: string[] = [];
  for (let time = keyToTime(startKey); time <= keyToTime(endKey) && keys.length < 400; time += DAY_MS) keys.push(timeToKey(time));
  return keys;
}

/**
 * Same figures as the web tracking panel, over calendar days: pace, projection and how much is
 * needed per remaining day. Average-ticket goals are not cumulative, so they carry no pace.
 */
export function mobileGoalSummary(period: MobileGoalPeriodInput, todayKey: string) {
  const up = period.upValue ?? period.targetValue * 1.2;
  const top = period.topValue && period.topValue > up ? period.topValue : null;
  const days = goalDistributionDays(period);
  const totalDays = Math.max(days.length, 1);
  const elapsedDays = Math.min(days.filter((key) => key <= todayKey).length, totalDays);
  const remainingDays = Math.max(totalDays - elapsedDays, 0);
  const cumulative = period.type !== "ticket";
  const pace = cumulative && elapsedDays > 0 ? period.currentValue / elapsedDays : 0;
  const levels = [
    { id: "target" as const, label: "Meta", amount: period.targetValue },
    { id: "up" as const, label: "UP", amount: up },
    ...(top ? [{ id: "top" as const, label: "TOP", amount: top }] : []),
  ];
  const next = levels.find((level) => period.currentValue < level.amount) ?? null;
  return {
    currentValue: round(period.currentValue),
    levels: levels.map((level) => ({ ...level, amount: round(level.amount), reached: period.currentValue >= level.amount })),
    percentOfTarget: period.targetValue > 0 ? round((period.currentValue / period.targetValue) * 100) : 0,
    nextLevel: next ? { label: next.label, remaining: round(next.amount - period.currentValue) } : null,
    totalDays,
    elapsedDays,
    remainingDays,
    cumulative,
    projection: cumulative ? round(pace * totalDays) : null,
    neededDaily: cumulative && next && remainingDays > 0 ? round((next.amount - period.currentValue) / remainingDays) : null,
    dailyTarget: cumulative ? round(period.targetValue / totalDays) : null,
  };
}

/** Day by day, newest first, up to today; each day compared with the daily share of the goal. */
export function mobileGoalDays(period: MobileGoalPeriodInput, todayKey: string) {
  const distribution = goalDistributionDays(period);
  const scheduledDays = new Set(distribution);
  const dailyTarget = period.type !== "ticket" ? period.targetValue / Math.max(distribution.length, 1) : null;
  return dayKeysBetween(period.startKey, period.endKey)
    .filter((key) => key <= todayKey)
    .reverse()
    .map((key) => {
      const value = round(period.dailyProgress[key] ?? 0);
      // A day outside the distribution carries no daily target: revenue there is not "below the goal".
      return { date: key, value, reachedDailyTarget: dailyTarget === null || !scheduledDays.has(key) ? null : value >= dailyTarget };
    });
}

function resolveRole(goals: EmployeeGoal[]): GoalParticipantRole {
  if (goals.some((goal) => goal.participantRole === "leader")) return "leader";
  if (goals.some((goal) => goal.participantRole === "relief")) return "relief";
  return "fixed";
}

/** One row per person, even when the person has more than one shift goal in the period. */
export function mobileGoalTeam(employeeGoals: EmployeeGoal[]) {
  const byEmployee = new Map<string, EmployeeGoal[]>();
  for (const goal of employeeGoals) byEmployee.set(goal.employeeId, [...(byEmployee.get(goal.employeeId) ?? []), goal]);
  return [...byEmployee.entries()].map(([employeeId, goals]) => {
    const currentValue = goals.reduce((sum, goal) => sum + (goal.currentValue ?? 0), 0);
    const targetValue = goals.reduce((sum, goal) => sum + (goal.targetValue ?? 0), 0);
    return {
      employeeId,
      role: resolveRole(goals),
      scheduledTurns: goals.reduce((sum, goal) => sum + (goal.scheduledTurnCount ?? 0), 0),
      currentValue: round(currentValue),
      targetValue: round(targetValue),
      percent: targetValue > 0 ? round((currentValue / targetValue) * 100) : 0,
    };
  });
}

/**
 * Prize the team would earn if the period closed with today's revenue, split per person by the
 * tiered method: fixed staff share equally what is left after the relief worker's covered turns,
 * and the leader receives the leadership factor. Mirrors the closing calculation of the web system.
 */
export function mobileGoalPrize(period: MobileGoalPeriodInput, team: ReturnType<typeof mobileGoalTeam>) {
  const method = period.method;
  if (!method || method.type !== "tiered_unit_bonus") return null;
  const bonusRows = team.filter((row) => row.role !== "leader");
  const fixedRows = bonusRows.filter((row) => row.role !== "relief");
  const reliefRows = bonusRows.filter((row) => row.role === "relief");
  const turnsPerDay = Math.max(method.teamBonus.reliefWorker?.turnsPerDay ?? period.shiftCount ?? 1, 1);
  const totalPeriodTurns = Math.max(dayKeysBetween(period.startKey, period.endKey).length, 1) * turnsPerDay;
  let result: ReturnType<typeof calculateTieredGoalBonus>;
  try {
    result = calculateTieredGoalBonus(method, period.currentValue, bonusRows.length, {
      fixedCollaboratorCount: fixedRows.length,
      reliefWorkerCount: reliefRows.length,
      reliefWorkerCoveredTurnsByPerson: reliefRows.map((row) => row.scheduledTurns),
      totalPeriodTurns,
    });
  } catch {
    // A method without usable team/tier configuration has no prize to show.
    return null;
  }
  if (!result) return null;
  const reliefBonus = new Map(reliefRows.map((row, index) => [row.employeeId, result!.reliefWorkerSplit?.reliefWorkerBonuses[index] ?? result!.perCollaboratorBonus]));
  const fixedBonus = result.reliefWorkerSplit?.perFixedCollaboratorBonus ?? result.perCollaboratorBonus;
  const amount = (value: number) => round(Number.isFinite(value) ? value : 0);
  return {
    methodName: method.name,
    tiers: [...method.tiers].sort((left, right) => left.fromAmount - right.fromAmount).map((tier) => ({
      label: tier.label, fromAmount: round(tier.fromAmount), fixedBonusAmount: round(tier.fixedBonusAmount), excessPercent: tier.excessPercent,
      reached: period.currentValue >= tier.fromAmount,
    })),
    highestTierLabel: result.highestAchievedTier?.label ?? null,
    nextTier: result.nextTier ? { label: result.nextTier.label, remaining: amount(result.remainingToNextTier ?? 0) } : null,
    totalTeamBonus: amount(result.totalTeamBonus),
    leadershipBonus: amount(result.leadershipBonus),
    message: result.incentiveMessage?.message ?? null,
    byEmployee: Object.fromEntries(team.map((row) => [row.employeeId, amount(
      row.role === "leader" ? result!.leadershipBonus : row.role === "relief" ? reliefBonus.get(row.employeeId) ?? result!.perCollaboratorBonus : fixedBonus,
    )])),
  };
}
