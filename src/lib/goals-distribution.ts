import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { eachDayOfInterval } from 'date-fns';

import { db } from '@/lib/firebase';
import type { EmployeeGoal, GoalClosureSnapshot, GoalDistributionMode, GoalPeriodDoc } from '@/types';

type ShiftRecord = {
  unitId?: string;
  userId?: string;
  date?: string;
  type?: 'work' | 'day_off';
};

export interface GoalDistributionSnapshot {
  periodDateKeysById: Record<string, string[]>;
  employeeDateKeysByGoalId: Record<string, string[]>;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getCalendarDateKeys(start: Date, end: Date) {
  return eachDayOfInterval({ start, end }).map(dateKey);
}

function getPeriodStartKey(period: GoalPeriodDoc) {
  return dateKey(period.startDate?.toDate?.() ?? new Date());
}

function getPeriodEndKey(period: GoalPeriodDoc) {
  return dateKey(period.endDate?.toDate?.() ?? new Date());
}

function groupPeriodsByKioskAndMonth(periods: GoalPeriodDoc[]) {
  const grouped = new Map<string, GoalPeriodDoc[]>();

  for (const period of periods) {
    const start = period.startDate?.toDate?.() ?? new Date();
    const monthKey = `${period.kioskId}__${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    const existing = grouped.get(monthKey);
    if (existing) existing.push(period);
    else grouped.set(monthKey, [period]);
  }

  return grouped;
}

export function resolveGoalDistributionMode(entity: { distributionMode?: GoalDistributionMode | null | undefined }) {
  return entity.distributionMode ?? 'calendar_days';
}

export function getPeriodDistributionDateKeys(period: GoalPeriodDoc, snapshot?: GoalDistributionSnapshot | null) {
  if (resolveGoalDistributionMode(period) !== 'scheduled_days') {
    return getCalendarDateKeys(period.startDate?.toDate?.() ?? new Date(), period.endDate?.toDate?.() ?? new Date());
  }

  const scheduledKeys = snapshot?.periodDateKeysById?.[period.id] ?? [];
  return scheduledKeys.length > 0
    ? scheduledKeys
    : getCalendarDateKeys(period.startDate?.toDate?.() ?? new Date(), period.endDate?.toDate?.() ?? new Date());
}

export function getEmployeeDistributionDateKeys(
  employeeGoal: EmployeeGoal,
  period: GoalPeriodDoc,
  snapshot?: GoalDistributionSnapshot | null
) {
  if (resolveGoalDistributionMode(employeeGoal) !== 'scheduled_days' && resolveGoalDistributionMode(period) !== 'scheduled_days') {
    return getCalendarDateKeys(period.startDate?.toDate?.() ?? new Date(), period.endDate?.toDate?.() ?? new Date());
  }

  const scheduledKeys = snapshot?.employeeDateKeysByGoalId?.[employeeGoal.id] ?? [];
  return scheduledKeys.length > 0
    ? scheduledKeys
    : getCalendarDateKeys(period.startDate?.toDate?.() ?? new Date(), period.endDate?.toDate?.() ?? new Date());
}

export function getPeriodDistributionDayCount(period: GoalPeriodDoc, snapshot?: GoalDistributionSnapshot | null) {
  return Math.max(getPeriodDistributionDateKeys(period, snapshot).length, 1);
}

export function getEmployeeDistributionDayCount(
  employeeGoal: EmployeeGoal,
  period: GoalPeriodDoc,
  snapshot?: GoalDistributionSnapshot | null
) {
  return Math.max(getEmployeeDistributionDateKeys(employeeGoal, period, snapshot).length, 1);
}

export async function loadGoalDistributionSnapshot(
  periods: GoalPeriodDoc[],
  employeeGoals: EmployeeGoal[]
): Promise<GoalDistributionSnapshot> {
  const scheduledPeriods = periods.filter(period => resolveGoalDistributionMode(period) === 'scheduled_days');
  if (scheduledPeriods.length === 0) {
    return { periodDateKeysById: {}, employeeDateKeysByGoalId: {} };
  }

  const employeeGoalsByPeriodId = new Map<string, EmployeeGoal[]>();
  for (const goal of employeeGoals) {
    const bucket = employeeGoalsByPeriodId.get(goal.periodId);
    if (bucket) bucket.push(goal);
    else employeeGoalsByPeriodId.set(goal.periodId, [goal]);
  }

  const periodDateSetsById = new Map<string, Set<string>>();
  const employeeDateSetsByGoalId = new Map<string, Set<string>>();
  const groupedPeriods = groupPeriodsByKioskAndMonth(scheduledPeriods);

  for (const grouped of groupedPeriods.values()) {
    const kioskId = grouped[0]?.kioskId;
    if (!kioskId) continue;

    const rangeStart = grouped
      .map(getPeriodStartKey)
      .sort()[0];
    const rangeEnd = grouped
      .map(getPeriodEndKey)
      .sort()
      .slice(-1)[0];

    if (!rangeStart || !rangeEnd) continue;

    const scheduledGoals = grouped.flatMap(period =>
      (employeeGoalsByPeriodId.get(period.id) ?? []).filter(goal =>
        resolveGoalDistributionMode(goal) === 'scheduled_days' || resolveGoalDistributionMode(period) === 'scheduled_days'
      )
    );

    const scheduledGoalsByUserId = new Map<string, EmployeeGoal[]>();
    for (const goal of scheduledGoals) {
      const bucket = scheduledGoalsByUserId.get(goal.employeeId);
      if (bucket) bucket.push(goal);
      else scheduledGoalsByUserId.set(goal.employeeId, [goal]);
    }

    try {
      const shiftsSnap = await getDocs(
        query(
          collectionGroup(db, 'shifts'),
          where('unitId', '==', kioskId),
          where('date', '>=', rangeStart),
          where('date', '<=', rangeEnd),
          where('type', '==', 'work')
        )
      );

      const periodRanges = grouped.map(period => ({
        period,
        startKey: getPeriodStartKey(period),
        endKey: getPeriodEndKey(period),
      }));

      for (const docSnap of shiftsSnap.docs) {
        const shift = docSnap.data() as ShiftRecord;
        if (!shift.date || !shift.userId) continue;

        for (const { period, startKey, endKey } of periodRanges) {
          if (shift.date < startKey || shift.date > endKey) continue;

          let periodSet = periodDateSetsById.get(period.id);
          if (!periodSet) {
            periodSet = new Set<string>();
            periodDateSetsById.set(period.id, periodSet);
          }
          periodSet.add(shift.date);
        }

        const goalsForUser = scheduledGoalsByUserId.get(shift.userId) ?? [];
        for (const goal of goalsForUser) {
          const goalPeriod = grouped.find(period => period.id === goal.periodId);
          if (!goalPeriod) continue;
          const startKey = getPeriodStartKey(goalPeriod);
          const endKey = getPeriodEndKey(goalPeriod);
          if (shift.date < startKey || shift.date > endKey) continue;

          let goalSet = employeeDateSetsByGoalId.get(goal.id);
          if (!goalSet) {
            goalSet = new Set<string>();
            employeeDateSetsByGoalId.set(goal.id, goalSet);
          }
          goalSet.add(shift.date);
        }
      }
    } catch (error) {
      console.warn('[goals-distribution] failed to load scheduled days', { kioskId, rangeStart, rangeEnd, error });
    }
  }

  return {
    periodDateKeysById: Object.fromEntries(
      Array.from(periodDateSetsById.entries()).map(([periodId, dateKeys]) => [periodId, Array.from(dateKeys).sort()])
    ),
    employeeDateKeysByGoalId: Object.fromEntries(
      Array.from(employeeDateSetsByGoalId.entries()).map(([goalId, dateKeys]) => [goalId, Array.from(dateKeys).sort()])
    ),
  };
}

export function buildGoalClosureSnapshot(
  period: GoalPeriodDoc,
  employeeGoals: EmployeeGoal[],
  distributionSnapshot?: GoalDistributionSnapshot | null
): GoalClosureSnapshot {
  const periodDateKeys = getPeriodDistributionDateKeys(period, distributionSnapshot);
  const periodDayCount = Math.max(periodDateKeys.length, 1);

  const employeeDateKeysByGoalId: Record<string, string[]> = {};
  const employeeDayCountsByGoalId: Record<string, number> = {};
  const employeeDailyTargetsByGoalId: Record<string, number> = {};

  for (const employeeGoal of employeeGoals) {
    const goalDateKeys = getEmployeeDistributionDateKeys(employeeGoal, period, distributionSnapshot);
    const goalDayCount = Math.max(goalDateKeys.length, 1);
    employeeDateKeysByGoalId[employeeGoal.id] = goalDateKeys;
    employeeDayCountsByGoalId[employeeGoal.id] = goalDayCount;
    employeeDailyTargetsByGoalId[employeeGoal.id] = employeeGoal.targetValue / goalDayCount;
  }

  return {
    distributionMode: resolveGoalDistributionMode(period),
    periodDateKeys,
    periodDayCount,
    dailyTarget: period.targetValue / periodDayCount,
    dailyUpTarget: (period.upValue ?? period.targetValue * 1.2) / periodDayCount,
    employeeDateKeysByGoalId,
    employeeDayCountsByGoalId,
    employeeDailyTargetsByGoalId,
  };
}
