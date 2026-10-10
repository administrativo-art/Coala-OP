import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit } from "@/lib/unit-access";
import { safeAvatarUrl } from "@/features/collaborator-schedule/mobile-schedule";
import { loadScheduledGoalDateKeys } from "@/features/collaborator-schedule/mobile-schedule.server";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import type { EmployeeGoal, GoalPeriodDoc } from "@/types";
import { mobileGoalDays, mobileGoalPrize, mobileGoalSummary, mobileGoalTeam, type MobileGoalPeriodInput } from "./mobile-goals";

const MAX_ACTIVE_PERIODS = 10;
const MAX_EMPLOYEE_GOALS = 200;

const TYPE_LABELS: Record<GoalPeriodDoc["templateType"] & string, string> = {
  revenue: "Faturamento",
  ticket: "Ticket médio",
  product_line: "Linha de produtos",
  product_specific: "Produto",
};

function failure(code: string, safeMessage: string, kind: "VALIDATION" | "AUTHORIZATION" | "NOT_FOUND" = "AUTHORIZATION"): never {
  throw new AppError({ code: `MOBILE_GOALS_${code}`, kind, safeMessage });
}

/** Permission from the app list; seeing goals in the web system does not grant it here. */
export function assertCanViewMobileGoals(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && actor.permissions.app?.goals?.view !== true) failure("FORBIDDEN", "Sua conta não possui permissão para ver metas pelo aplicativo.");
}

function dayKey(value: unknown, fallback: string) {
  const date = (value as { toDate?: () => Date } | undefined)?.toDate?.();
  return date ? todayInClosureTimezone(date) : fallback;
}

/** Units whose goals this user may see: the same unit scope every other module of the app applies. */
export async function listMobileGoalUnits(actor: ServerUserContext) {
  assertCanViewMobileGoals(actor);
  const snapshot = await dbAdmin.collection("kiosks").limit(201).get();
  return snapshot.docs
    .filter((document) => canAccessUnit(actor.userDoc, document.id, { isDefaultAdmin: actor.isDefaultAdmin }))
    .map((document) => ({ id: document.id, name: String(document.get("name") || document.get("displayName") || document.id) }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** Active goals of one unit, with the team scoreboard and the prize forecast. Read on demand, never polled. */
export async function loadMobileUnitGoals(actor: ServerUserContext, kioskId: string) {
  assertCanViewMobileGoals(actor);
  if (!canAccessUnit(actor.userDoc, kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) failure("UNIT_FORBIDDEN", "A unidade não está no escopo da sua conta.");
  const today = todayInClosureTimezone();
  const periodsSnapshot = await dbAdmin.collection("goalPeriods").where("kioskId", "==", kioskId).where("status", "==", "active").limit(MAX_ACTIVE_PERIODS).get();
  const periods = periodsSnapshot.docs.map((document) => ({ ...(document.data() as GoalPeriodDoc), id: document.id }));
  const goalSnapshots = await Promise.all(periods.map((period) =>
    dbAdmin.collection("employeeGoals").where("periodId", "==", period.id).limit(MAX_EMPLOYEE_GOALS).get()));
  const employeeIds = [...new Set(goalSnapshots.flatMap((snapshot) => snapshot.docs.map((document) => String(document.get("employeeId") ?? ""))).filter(Boolean))];
  const userSnapshots = employeeIds.length ? await dbAdmin.getAll(...employeeIds.map((id) => dbAdmin.collection("users").doc(id))) : [];
  const names = new Map(userSnapshots.map((snapshot) => [snapshot.id, String(snapshot.get("username") || snapshot.get("name") || "Colaborador")]));
  const avatars = new Map(userSnapshots.map((snapshot) => [snapshot.id, safeAvatarUrl(snapshot.get("avatarUrl"))]));
  const unit = periods.some((period) => period.distributionMode === "scheduled_days") ? await dbAdmin.collection("kiosks").doc(kioskId).get() : null;
  const unitName = String(unit?.get("name") || unit?.get("displayName") || "");
  // The period itself says how its days are counted; "scheduled days" come from the unit's schedule, as in the web panel.
  const scheduledDays = await Promise.all(periods.map((period, index) => period.distributionMode !== "scheduled_days" ? null
    : loadScheduledGoalDateKeys({
      kioskName: unitName, startKey: dayKey(period.startDate, today), endKey: dayKey(period.endDate, today),
      employeeIds: [...new Set(goalSnapshots[index]!.docs.map((document) => String(document.get("employeeId") ?? "")).filter(Boolean))],
    }).catch(() => null)));

  const goals = periods.map((period, index) => {
    const employeeGoals = goalSnapshots[index]!.docs.map((document) => ({ ...(document.data() as EmployeeGoal), id: document.id }));
    const input: MobileGoalPeriodInput = {
      id: period.id,
      type: period.templateType ?? "revenue",
      startKey: dayKey(period.startDate, today),
      endKey: dayKey(period.endDate, today),
      targetValue: Number(period.targetValue ?? 0),
      upValue: period.upValue,
      topValue: period.topValue,
      currentValue: Number(period.currentValue ?? 0),
      dailyProgress: period.dailyProgress ?? {},
      shiftCount: period.shifts?.length ?? 1,
      method: period.goalMethodSnapshot ?? null,
      activeDays: scheduledDays[index] ?? undefined,
    };
    const team = mobileGoalTeam(employeeGoals);
    const prize = mobileGoalPrize(input, team);
    return {
      id: period.id,
      typeLabel: TYPE_LABELS[input.type] ?? "Meta",
      startDate: input.startKey,
      endDate: input.endKey,
      summary: mobileGoalSummary(input, today),
      days: mobileGoalDays(input, today),
      team: team
        .map((row) => ({
          name: names.get(row.employeeId) ?? "Colaborador",
          avatarUrl: avatars.get(row.employeeId) ?? null,
          isMe: row.employeeId === actor.userDoc.id,
          role: row.role,
          currentValue: row.currentValue,
          targetValue: row.targetValue,
          percent: row.percent,
          prize: prize ? prize.byEmployee[row.employeeId] ?? 0 : null,
        }))
        .sort((left, right) => right.percent - left.percent || left.name.localeCompare(right.name, "pt-BR")),
      prize: prize ? { methodName: prize.methodName, tiers: prize.tiers, highestTierLabel: prize.highestTierLabel, nextTier: prize.nextTier,
        totalTeamBonus: prize.totalTeamBonus, leadershipBonus: prize.leadershipBonus, message: prize.message } : null,
    };
  }).sort((left, right) => left.typeLabel.localeCompare(right.typeLabel, "pt-BR") || left.startDate.localeCompare(right.startDate));
  return { kioskId, today, goals };
}
