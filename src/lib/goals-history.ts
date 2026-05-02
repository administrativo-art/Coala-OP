import { eachDayOfInterval } from 'date-fns';

import type { GoalClosureSnapshot, GoalDistributionMode, GoalPeriodDoc } from '@/types';

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getGoalClosureSnapshot(period: GoalPeriodDoc): GoalClosureSnapshot | null {
  return period.status === 'active' ? null : period.closureSnapshot ?? null;
}

export function getGoalPeriodCalendarDayCount(period: GoalPeriodDoc) {
  const start = period.startDate?.toDate?.() ?? new Date();
  const end = period.endDate?.toDate?.() ?? start;
  return Math.max(eachDayOfInterval({ start, end }).length, 1);
}

export function getGoalPeriodResolvedDayCount(period: GoalPeriodDoc) {
  return getGoalClosureSnapshot(period)?.periodDayCount ?? getGoalPeriodCalendarDayCount(period);
}

export function getGoalPeriodResolvedDailyTarget(period: GoalPeriodDoc) {
  return getGoalClosureSnapshot(period)?.dailyTarget ?? (period.targetValue / getGoalPeriodResolvedDayCount(period));
}

export function getGoalPeriodResolvedDailyUpTarget(period: GoalPeriodDoc) {
  return (
    getGoalClosureSnapshot(period)?.dailyUpTarget ??
    ((period.upValue ?? period.targetValue * 1.2) / getGoalPeriodResolvedDayCount(period))
  );
}

export function getGoalPeriodResolvedMode(period: GoalPeriodDoc): GoalDistributionMode {
  return getGoalClosureSnapshot(period)?.distributionMode ?? period.distributionMode ?? 'calendar_days';
}

export function getGoalPeriodResolvedDateKeys(period: GoalPeriodDoc) {
  const frozen = getGoalClosureSnapshot(period)?.periodDateKeys;
  if (frozen && frozen.length > 0) return frozen;

  const start = period.startDate?.toDate?.() ?? new Date();
  const end = period.endDate?.toDate?.() ?? start;
  return eachDayOfInterval({ start, end }).map(dateKey);
}

export function getGoalDistributionModeLabel(mode: GoalDistributionMode) {
  return mode === 'scheduled_days' ? 'Escala congelada' : 'Dias corridos';
}

export function getGoalAttainment(period: GoalPeriodDoc) {
  if (period.targetValue <= 0) return 0;
  return (period.currentValue / period.targetValue) * 100;
}
