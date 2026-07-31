import { dbAdmin } from "@/lib/firebase-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import { buildCollaboratorSchedulePayload } from "@/features/collaborator-schedule/server";

function compactUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function serializeValue(value: unknown): unknown {
  if (!value) return value;
  if (typeof value !== "object") return value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeValue(entry)]));
}

function dateKeyFromTimestamp(value: unknown) {
  const date = typeof (value as { toDate?: unknown })?.toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : new Date(value as string | number | Date);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function extractShiftTimes(label: string): { start: string; end: string } | null {
  const match = label.match(/\((\d{2}:\d{2})[–\-](\d{2}:\d{2})\)/u);
  return match ? { start: match[1], end: match[2] } : null;
}

export function canAccessCollaboratorDashboard(access: ServerUserContext) {
  return access.permissions.dashboard.collaborator === true || access.permissions.dashboard.view === true;
}

export async function buildCollaboratorDashboardPayload(access: ServerUserContext, now = new Date()) {
  const user = access.userDoc;
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const pdvAccessIds = Array.isArray(user.pdvAccesses)
    ? user.pdvAccesses.map((entry) => entry.externalUserId)
    : [];
  const userIds = compactUnique([
    access.decoded.uid,
    user.id,
    user.hrEmployeeId,
    user.registrationIdBizneo,
    user.registrationIdPdv,
    ...pdvAccessIds,
  ]);
  const schedulePayload = await buildCollaboratorSchedulePayload(
    access,
    year,
    month
  );
  const visibleShifts = schedulePayload.shifts;

  const activePeriodsSnap = await dbAdmin.collection("goalPeriods").where("status", "==", "active").get();
  const activePeriods = activePeriodsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>));
  const activePeriodIds = new Set(activePeriods.map((period) => period.id));

  const employeeGoalsSnap = await dbAdmin.collection("employeeGoals").get();
  const allGoals = employeeGoalsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>))
    .filter((goal) => activePeriodIds.has(goal.periodId));

  const ownGoals = allGoals.filter((goal) => userIds.includes(String(goal.employeeId)));
  const assignedKioskIds = new Set(user.assignedKioskIds ?? []);
  const visibleGoals = ownGoals.length > 0
    ? ownGoals
    : allGoals.filter((goal) => assignedKioskIds.has(String(goal.kioskId)));
  const visiblePeriodIds = new Set(visibleGoals.map((goal) => goal.periodId));
  const visiblePeriods = activePeriods.filter((period) => visiblePeriodIds.has(period.id));
  const visibleTeamGoals = allGoals.filter((goal) => visiblePeriodIds.has(goal.periodId));

  const periodDateSetsById = new Map<string, Set<string>>();
  const employeeDateSetsByGoalId = new Map<string, Set<string>>();
  const goalIdsByPeriodShiftAndDate = new Map<string, Set<string>>();
  const workedDateSetsByKioskAndUser = new Map<string, Set<string>>();
  const shiftLabelsByKioskUserAndDate = new Map<string, Record<string, string>>();

  const periodById = new Map(visiblePeriods.map((period) => [period.id, period]));

  for (const goal of visibleGoals) {
    const period = periodById.get(goal.periodId);
    if (!period) continue;
    const startKey = dateKeyFromTimestamp(period.startDate);
    const endKey = dateKeyFromTimestamp(period.endDate);
    const expectedShift = goal.shiftId
      ? (period.shifts ?? []).find((shift: any) => shift.id === goal.shiftId)
      : null;
    const expectedTimes = expectedShift?.label ? extractShiftTimes(expectedShift.label) : null;

    for (const shift of visibleShifts as any[]) {
      if (shift.type !== "work" || !shift.date || shift.date < startKey || shift.date > endKey) continue;
      if (expectedTimes && (shift.startTime !== expectedTimes.start || shift.endTime !== expectedTimes.end)) continue;

      const goalDateSet = employeeDateSetsByGoalId.get(goal.id) ?? new Set<string>();
      goalDateSet.add(shift.date);
      employeeDateSetsByGoalId.set(goal.id, goalDateSet);

      const periodDateSet = periodDateSetsById.get(period.id) ?? new Set<string>();
      periodDateSet.add(shift.date);
      periodDateSetsById.set(period.id, periodDateSet);

      const kioskUserKey = `${goal.kioskId}__${goal.employeeId}`;
      const workedDateSet = workedDateSetsByKioskAndUser.get(kioskUserKey) ?? new Set<string>();
      workedDateSet.add(shift.date);
      workedDateSetsByKioskAndUser.set(kioskUserKey, workedDateSet);

      const labels = shiftLabelsByKioskUserAndDate.get(kioskUserKey) ?? {};
      labels[shift.date] = `${shift.startTime}–${shift.endTime}`;
      shiftLabelsByKioskUserAndDate.set(kioskUserKey, labels);

      const shiftKey = goal.shiftId ?? "__legacy__";
      const periodShiftDateKey = `${period.id}__${shiftKey}__${shift.date}`;
      const goalIdSet = goalIdsByPeriodShiftAndDate.get(periodShiftDateKey) ?? new Set<string>();
      goalIdSet.add(goal.id);
      goalIdsByPeriodShiftAndDate.set(periodShiftDateKey, goalIdSet);
    }
  }

  return {
    shifts: serializeValue(visibleShifts),
    goalPeriods: serializeValue(visiblePeriods),
    employeeGoals: serializeValue(visibleTeamGoals),
    distributionSnapshot: {
      periodDateKeysById: Object.fromEntries(
        Array.from(periodDateSetsById.entries()).map(([id, dates]) => [id, Array.from(dates).sort()])
      ),
      employeeDateKeysByGoalId: Object.fromEntries(
        Array.from(employeeDateSetsByGoalId.entries()).map(([id, dates]) => [id, Array.from(dates).sort()])
      ),
      goalIdsByPeriodShiftAndDate: Object.fromEntries(
        Array.from(goalIdsByPeriodShiftAndDate.entries()).map(([key, goalIds]) => [key, Array.from(goalIds).sort()])
      ),
      workedDaysByKioskAndUser: Object.fromEntries(
        Array.from(workedDateSetsByKioskAndUser.entries()).map(([key, dates]) => [key, Array.from(dates).sort()])
      ),
      shiftLabelByKioskUserAndDate: Object.fromEntries(shiftLabelsByKioskUserAndDate.entries()),
    },
  };
}
