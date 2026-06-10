import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function dateKeyFromTimestamp(value: any) {
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function extractShiftTimes(label: string): { start: string; end: string } | null {
  const match = label.match(/\((\d{2}:\d{2})[–\-](\d{2}:\d{2})\)/u);
  return match ? { start: match[1], end: match[2] } : null;
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireUser(request);
    const user = access.userDoc;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 0);
    const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

    const userIds = compactUnique([access.decoded.uid, user.id, user.registrationIdBizneo, user.registrationIdPdv]);
    const userNames = compactUnique([user.username, user.email]).map(normalizeIdentity);

    const schedulesSnap = await dbAdmin
      .collection("dp_schedules")
      .where("year", "==", year)
      .where("month", "==", month)
      .get();

    const shiftsNested = await Promise.all(
      schedulesSnap.docs.map(async (scheduleDoc) => {
        const schedule = { id: scheduleDoc.id, ...scheduleDoc.data() } as Record<string, any>;
        const snapshotMatchedUserIds = Object.entries(schedule.snapshot?.users ?? {})
          .filter(([, snapshotUser]) => userNames.includes(normalizeIdentity((snapshotUser as any)?.username)))
          .map(([id]) => id);
        const acceptedIds = new Set([...userIds, ...snapshotMatchedUserIds]);

        const shiftsSnap = await scheduleDoc.ref.collection("shifts").get();
        return shiftsSnap.docs
          .map((doc) => ({ id: doc.id, scheduleId: scheduleDoc.id, ...doc.data() }))
          .filter((shift: any) => acceptedIds.has(String(shift.userId)) && shift.date >= start && shift.date <= end);
      })
    );
    const visibleShifts = shiftsNested.flat();

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

    return NextResponse.json({
      shifts: serializeValue(visibleShifts),
      goalPeriods: serializeValue(visiblePeriods),
      employeeGoals: serializeValue(visibleGoals),
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
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao carregar painel do colaborador.",
      },
      { status: 403 }
    );
  }
}
