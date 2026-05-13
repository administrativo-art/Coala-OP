import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { calculateScheduledEmployeeGoalTargets, loadGoalDistributionSnapshot } from '@/lib/goals-distribution';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import type { DPUnit, EmployeeGoal, GoalPeriodDoc, GoalTemplate } from '@/types';

function periodOverlapsSchedule(period: GoalPeriodDoc, year: number, month: number) {
  const start = period.startDate?.toDate?.() ?? new Date(0);
  const end = period.endDate?.toDate?.() ?? new Date(8640000000000000);
  const scheduleStart = new Date(year, month - 1, 1);
  const scheduleEnd = new Date(year, month, 0, 23, 59, 59, 999);
  return start <= scheduleEnd && end >= scheduleStart;
}

export async function rebalanceGoalsForSchedule(scheduleId: string) {
  const scheduleSnap = await getDocs(query(collection(db, 'dp_schedules'), where('__name__', '==', scheduleId)));
  const scheduleDoc = scheduleSnap.docs[0];
  if (!scheduleDoc) return;

  const schedule = scheduleDoc.data() as { year?: number; month?: number; unitId?: string };
  if (!schedule.year || !schedule.month || !schedule.unitId) return;

  const [unitsSnap, kiosksSnap, templatesSnap, periodsSnap, employeeGoalsSnap] = await Promise.all([
    getDocs(collection(db, 'dp_units')),
    getDocs(collection(db, 'kiosks')),
    getDocs(collection(db, 'goalTemplates')),
    getDocs(query(collection(db, 'goalPeriods'), where('status', '==', 'active'))),
    getDocs(collection(db, 'employeeGoals')),
  ]);

  const units = unitsSnap.docs.map(item => ({ id: item.id, ...item.data() } as DPUnit));
  const scheduleUnit = units.find(unit => unit.id === schedule.unitId);
  if (!scheduleUnit) return;

  const kiosks = kiosksSnap.docs.map(item => ({ id: item.id, ...item.data() } as { id: string; name?: string }));
  const matchingKiosk = kiosks.find(kiosk => kiosk.name && matchDPUnitForKiosk(kiosk.name, [scheduleUnit])?.id === scheduleUnit.id);
  if (!matchingKiosk) return;

  const templates = new Map(templatesSnap.docs.map(item => [item.id, { id: item.id, ...item.data() } as GoalTemplate]));
  const employeeGoals = employeeGoalsSnap.docs.map(item => ({ id: item.id, ...item.data() } as EmployeeGoal));

  const periods = periodsSnap.docs
    .map(item => ({ id: item.id, ...item.data() } as GoalPeriodDoc))
    .filter(period => {
      const template = templates.get(period.templateId);
      const type = template?.type ?? 'revenue';
      return (
        type === 'revenue' &&
        period.kioskId === matchingKiosk.id &&
        periodOverlapsSchedule(period, schedule.year!, schedule.month!)
      );
    });

  for (const period of periods) {
    const periodEmployeeGoals = employeeGoals.filter(goal => goal.periodId === period.id);
    if (periodEmployeeGoals.length === 0) continue;

    const snapshot = await loadGoalDistributionSnapshot(
      [period],
      periodEmployeeGoals,
      { [matchingKiosk.id]: matchingKiosk.name ?? matchingKiosk.id }
    );
    const targets = calculateScheduledEmployeeGoalTargets(period, periodEmployeeGoals, snapshot);
    const entries = Object.entries(targets);
    if (entries.length === 0) continue;

    const batch = writeBatch(db);
    for (const [goalId, target] of entries) {
      batch.update(doc(db, 'employeeGoals', goalId), {
        targetValue: target.targetValue,
        fraction: target.fraction,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}
