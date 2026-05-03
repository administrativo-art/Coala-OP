import { collection, getDocs, query, where } from 'firebase/firestore';
import { eachDayOfInterval } from 'date-fns';

import { db } from '@/lib/firebase';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import type { DPUnit, EmployeeGoal, GoalClosureSnapshot, GoalDistributionMode, GoalPeriodDoc } from '@/types';

type ShiftRecord = {
  unitId?: string;
  userId?: string;
  date?: string;
  type?: 'work' | 'day_off';
  startTime?: string;
  endTime?: string;
};

export interface GoalDistributionSnapshot {
  periodDateKeysById: Record<string, string[]>;
  employeeDateKeysByGoalId: Record<string, string[]>;
  // key: `${kioskId}__${userId}` — scoped to kiosk so employees in multiple units don't bleed over
  workedDaysByKioskAndUser: Record<string, string[]>;
  shiftLabelByKioskUserAndDate: Record<string, Record<string, string>>;
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

const IN_CHUNK_SIZE = 30;

// kioskNameById: optional map from kiosk Firestore ID → kiosk display name.
// When provided, shifts are scoped per-kiosk using dp_unit name matching,
// so employees working in multiple units don't bleed shifts across kiosks.
export async function loadGoalDistributionSnapshot(
  periods: GoalPeriodDoc[],
  employeeGoals: EmployeeGoal[],
  kioskNameById?: Record<string, string>
): Promise<GoalDistributionSnapshot> {
  const empty: GoalDistributionSnapshot = {
    periodDateKeysById: {},
    employeeDateKeysByGoalId: {},
    workedDaysByKioskAndUser: {},
    shiftLabelByKioskUserAndDate: {},
  };

  if (periods.length === 0 || employeeGoals.length === 0) return empty;

  const allStartKeys = periods.map(getPeriodStartKey).sort();
  const allEndKeys = periods.map(getPeriodEndKey).sort();
  const globalRangeStart = allStartKeys[0]!;
  const globalRangeEnd = allEndKeys[allEndKeys.length - 1]!;

  const periodById = new Map(periods.map(p => [p.id, p]));

  // Scheduled goals indexed by employee (for scheduled_days distribution)
  const scheduledGoalsByUserId = new Map<string, EmployeeGoal[]>();
  for (const goal of employeeGoals) {
    const period = periodById.get(goal.periodId);
    if (!period) continue;
    if (resolveGoalDistributionMode(goal) !== 'scheduled_days' && resolveGoalDistributionMode(period) !== 'scheduled_days') continue;
    const bucket = scheduledGoalsByUserId.get(goal.employeeId);
    if (bucket) bucket.push(goal);
    else scheduledGoalsByUserId.set(goal.employeeId, [goal]);
  }

  const periodDateSetsById = new Map<string, Set<string>>();
  const employeeDateSetsByGoalId = new Map<string, Set<string>>();
  const workedDateSetsByKioskAndUser = new Map<string, Set<string>>();
  const shiftLabelsByKioskUserAndDate = new Map<string, Record<string, string>>();

  // Build unitId → kioskId mapping when kiosk names are available.
  // Fetches dp_units once to match by name (fuzzy).
  const unitIdToKioskId = new Map<string, string>();
  if (kioskNameById && Object.keys(kioskNameById).length > 0) {
    try {
      const dpUnitsSnap = await getDocs(collection(db, 'dp_units'));
      const dpUnits = dpUnitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit));
      for (const [kioskId, kioskName] of Object.entries(kioskNameById)) {
        const matched = matchDPUnitForKiosk(kioskName, dpUnits);
        if (matched) unitIdToKioskId.set(matched.id, kioskId);
      }
    } catch (error) {
      console.warn('[goals-distribution] failed to load dp_units for kiosk matching', error);
    }
  }

  const allEmployeeIds = [...new Set(employeeGoals.map(g => g.employeeId))];

  // Step 1: Find dp_schedules for the relevant year(s) + month(s).
  const years = [...new Set(periods.map(p => p.startDate?.toDate?.()?.getFullYear() ?? new Date().getFullYear()))];
  const neededMonthYears = new Set(periods.map(p => {
    const d = p.startDate?.toDate?.() ?? new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}`;
  }));

  // scheduleId → kioskId (resolved from unitId, or null if unknown)
  const scheduleKioskId = new Map<string, string | null>();
  for (const year of years) {
    try {
      const schedulesSnap = await getDocs(
        query(collection(db, 'dp_schedules'), where('year', '==', year))
      );
      for (const doc of schedulesSnap.docs) {
        const data = doc.data() as { month?: number; year?: number; unitId?: string };
        if (!neededMonthYears.has(`${data.year}-${data.month}`)) continue;
        const kioskId = data.unitId ? (unitIdToKioskId.get(data.unitId) ?? null) : null;
        scheduleKioskId.set(doc.id, kioskId);
      }
    } catch (error) {
      console.warn('[goals-distribution] failed to load dp_schedules', { year, error });
    }
  }

  // Step 2: For each schedule, query shifts by userId and process.
  const periodRanges = periods.map(period => ({
    period,
    startKey: getPeriodStartKey(period),
    endKey: getPeriodEndKey(period),
  }));

  function processShift(shift: ShiftRecord, scheduleId: string) {
    if (!shift.date || !shift.userId || shift.type !== 'work') return;
    if (shift.date < globalRangeStart || shift.date > globalRangeEnd) return;

    const resolvedKioskId = scheduleKioskId.get(scheduleId) ?? null;

    // Determine which kiosks this shift should contribute to.
    // If we resolved a kiosk from the unit, use only that one.
    // Otherwise (no mapping available), attribute to all kiosks for this employee.
    const targetKioskIds: string[] = resolvedKioskId
      ? [resolvedKioskId]
      : [...new Set(
          employeeGoals
            .filter(g => g.employeeId === shift.userId)
            .map(g => periodById.get(g.periodId)?.kioskId)
            .filter((k): k is string => Boolean(k))
        )];

    for (const kioskId of targetKioskIds) {
      const key = `${kioskId}__${shift.userId}`;
      let dates = workedDateSetsByKioskAndUser.get(key);
      if (!dates) { dates = new Set(); workedDateSetsByKioskAndUser.set(key, dates); }
      dates.add(shift.date);

      if (shift.startTime && shift.endTime) {
        let labels = shiftLabelsByKioskUserAndDate.get(key);
        if (!labels) { labels = {}; shiftLabelsByKioskUserAndDate.set(key, labels); }
        labels[shift.date] = `${shift.startTime}–${shift.endTime}`;
      }
    }

    // Scheduled distribution date keys (existing logic)
    for (const { period, startKey, endKey } of periodRanges) {
      if (resolveGoalDistributionMode(period) !== 'scheduled_days') continue;
      if (resolvedKioskId && period.kioskId !== resolvedKioskId) continue;
      if (shift.date < startKey || shift.date > endKey) continue;
      let periodSet = periodDateSetsById.get(period.id);
      if (!periodSet) { periodSet = new Set(); periodDateSetsById.set(period.id, periodSet); }
      periodSet.add(shift.date);
    }

    const goalsForUser = scheduledGoalsByUserId.get(shift.userId) ?? [];
    for (const goal of goalsForUser) {
      const goalPeriod = periodById.get(goal.periodId);
      if (!goalPeriod) continue;
      if (resolvedKioskId && goalPeriod.kioskId !== resolvedKioskId) continue;
      const startKey = getPeriodStartKey(goalPeriod);
      const endKey = getPeriodEndKey(goalPeriod);
      if (shift.date < startKey || shift.date > endKey) continue;
      let goalSet = employeeDateSetsByGoalId.get(goal.id);
      if (!goalSet) { goalSet = new Set(); employeeDateSetsByGoalId.set(goal.id, goalSet); }
      goalSet.add(shift.date);
    }
  }

  for (const [scheduleId] of scheduleKioskId) {
    for (let i = 0; i < allEmployeeIds.length; i += IN_CHUNK_SIZE) {
      const chunk = allEmployeeIds.slice(i, i + IN_CHUNK_SIZE);
      try {
        const shiftsSnap = await getDocs(
          query(collection(db, 'dp_schedules', scheduleId, 'shifts'), where('userId', 'in', chunk))
        );
        shiftsSnap.docs.forEach(d => processShift(d.data() as ShiftRecord, scheduleId));
      } catch (error) {
        console.warn('[goals-distribution] failed to load shifts', { scheduleId, error });
      }
    }
  }

  return {
    periodDateKeysById: Object.fromEntries(
      Array.from(periodDateSetsById.entries()).map(([id, dates]) => [id, Array.from(dates).sort()])
    ),
    employeeDateKeysByGoalId: Object.fromEntries(
      Array.from(employeeDateSetsByGoalId.entries()).map(([id, dates]) => [id, Array.from(dates).sort()])
    ),
    workedDaysByKioskAndUser: Object.fromEntries(
      Array.from(workedDateSetsByKioskAndUser.entries()).map(([key, dates]) => [key, Array.from(dates).sort()])
    ),
    shiftLabelByKioskUserAndDate: Object.fromEntries(shiftLabelsByKioskUserAndDate.entries()),
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
