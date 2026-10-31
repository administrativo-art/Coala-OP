import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { matchDPUnitForKiosk } from "@/lib/dp-kiosk-match";
import { canAccessUnit } from "@/lib/unit-access";
import { AppError } from "@/lib/observability/app-error";
import { readOfficialScheduleShifts } from '@/features/dp/schedules/official-revision.server';
import type { DPUnit } from "@/types";
import { buildCollaboratorSchedulePayload } from "./server";
import { mobileProfileRole, safeAvatarUrl, safePersonColor, toMobileSchedule } from "./mobile-schedule";

function failure(code: string, safeMessage: string): never {
  throw new AppError({ code: `MOBILE_SCHEDULE_${code}`, kind: "AUTHORIZATION", safeMessage });
}

/** Permission from the app list; the web collaborator panel does not grant it here. */
export function assertCanViewMobileSchedule(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && actor.permissions.app?.schedule?.view !== true) failure("FORBIDDEN", "Sua conta não possui permissão para ver a escala pelo aplicativo.");
}

/**
 * The month's schedule of the units this person belongs to, by the same rule as the web
 * collaborator schedule: the schedule as it stands (locked or not), units linked to the person or
 * to their own shifts.
 */
export async function loadMobileSchedule(actor: ServerUserContext, year: number, month: number) {
  assertCanViewMobileSchedule(actor);
  const payload = await buildCollaboratorSchedulePayload(actor, year, month, await extraScheduleUnits(actor));
  const userIds = [...new Set(payload.teamUnits.flatMap((unit) => unit.shifts.map((shift) => shift.userId)).filter(Boolean))];
  const snapshots = userIds.length ? await dbAdmin.getAll(...userIds.map((id) => dbAdmin.collection("users").doc(id))) : [];
  return toMobileSchedule(payload,
    new Map(snapshots.map((snapshot) => [snapshot.id, safeAvatarUrl(snapshot.get("avatarUrl"))])),
    new Map(snapshots.map((snapshot) => [snapshot.id, safePersonColor(snapshot.get("color"))])));
}

/**
 * Units beyond the person's own, for whoever holds `app.schedule.viewAllUnits`: the default admin
 * sees every unit; anyone else, the schedule units that correspond to the units of their access.
 */
async function extraScheduleUnits(actor: ServerUserContext): Promise<string[] | "all"> {
  if (actor.isDefaultAdmin) return "all";
  if (actor.permissions.app?.schedule?.viewAllUnits !== true) return [];
  const [kiosks, units] = await Promise.all([dbAdmin.collection("kiosks").limit(201).get(), dpUnits()]);
  return [...new Set(kiosks.docs
    .filter((kiosk) => canAccessUnit(actor.userDoc, kiosk.id, { isDefaultAdmin: false }))
    .flatMap((kiosk) => matchDPUnitForKiosk(String(kiosk.get("name") ?? ""), units)?.id ?? []))];
}

const UNITS_TTL_MS = 10 * 60_000;
let dpUnitsCache: { expiresAt: number; value: Promise<DPUnit[]> } | null = null;

function dpUnits() {
  if (dpUnitsCache && dpUnitsCache.expiresAt > Date.now()) return dpUnitsCache.value;
  const entry = { expiresAt: Date.now() + UNITS_TTL_MS, value: dbAdmin.collection("dp_units").limit(301).get()
    .then((snapshot) => {
      if (snapshot.size > 300) throw new AppError({ code: 'MOBILE_GOALS_UNIT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há unidades demais para validar a meta com segurança.' });
      return snapshot.docs.map((document) => ({ ...(document.data() as DPUnit), id: document.id }));
    }) };
  entry.value.catch(() => { if (dpUnitsCache === entry) dpUnitsCache = null; });
  dpUnitsCache = entry;
  return entry.value;
}

/**
 * Days a "scheduled days" goal is distributed over, as the web goals panel derives them: dates in
 * the period on which a goal participant has a work shift in the schedules of that unit. An empty
 * result means "use calendar days", the same fallback the web applies.
 */
export async function loadScheduledGoalEvidence(input: { kioskName: string; startKey: string; endKey: string; employeeIds: string[] }) {
  if (!input.employeeIds.length) return { dateKeys: [], externalCoverageUserIds: [] };
  const unit = matchDPUnitForKiosk(input.kioskName, await dpUnits());
  if (!unit) {
    throw new AppError({
      code: 'MOBILE_GOALS_DP_UNIT_NOT_FOUND',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'A unidade da meta não está vinculada à escala do Departamento Pessoal.',
    });
  }
  const months = new Set<string>();
  let cursor = new Date(`${input.startKey.slice(0, 7)}-01T12:00:00.000Z`);
  const endMonth = input.endKey.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= endMonth) {
    months.add(cursor.toISOString().slice(0, 7));
    if (months.size > 24) {
      throw new AppError({ code: 'MOBILE_GOALS_PERIOD_TOO_LONG', kind: 'DATA_INTEGRITY', safeMessage: 'O período da meta é longo demais para validar a escala.' });
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 12));
  }
  const scheduleSnapshots = await Promise.all([...months].map((key) =>
    dbAdmin.collection("dp_schedules")
      .where("unitId", "==", unit.id)
      .where("year", "==", Number(key.slice(0, 4)))
      .where("month", "==", Number(key.slice(5, 7)))
      .limit(2)
      .get()));
  if (scheduleSnapshots.some((snapshot) => snapshot.size > 1)) {
    throw new AppError({ code: 'MOBILE_GOALS_SCHEDULE_AMBIGUOUS', kind: 'DATA_INTEGRITY', safeMessage: 'Há mais de uma escala da unidade na mesma competência.' });
  }
  const schedules = scheduleSnapshots.flatMap((snapshot) => snapshot.docs);
  const dates = new Set<string>();
  const externalCoverageUserIds = new Set<string>();
  for (const schedule of schedules) {
    const allowed = new Set(input.employeeIds);
    const shifts = (await readOfficialScheduleShifts({ scheduleId: schedule.id })).shifts;
    if (shifts.length > 2_000) {
        throw new AppError({ code: 'MOBILE_GOALS_SHIFT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há turnos demais para validar a meta com segurança.' });
    }
    for (const shift of shifts) {
        const userId = String(shift.userId ?? '');
        if (!allowed.has(userId)) continue;
        const date = String(shift.date ?? "");
        if (shift.type !== "work" || date < input.startKey || date > input.endKey) continue;
        if (shift.countsTowardGoals === false) externalCoverageUserIds.add(userId);
        else dates.add(date);
    }
  }
  return {
    dateKeys: [...dates].sort(),
    externalCoverageUserIds: [...externalCoverageUserIds].filter(Boolean).sort(),
  };
}

export async function loadScheduledGoalDateKeys(input: { kioskName: string; startKey: string; endKey: string; employeeIds: string[] }) {
  return (await loadScheduledGoalEvidence(input)).dateKeys;
}

/** The signed-in person's own card: name, role and photo, exactly as registered in Coala One. */
export function mobileProfile(actor: ServerUserContext) {
  const user = actor.userDoc as unknown as Record<string, unknown>;
  return {
    name: String(user.username || actor.decoded.email || "Usuário"),
    email: typeof actor.decoded.email === "string" ? actor.decoded.email : null,
    role: mobileProfileRole(user),
    avatarUrl: safeAvatarUrl(user.avatarUrl),
  };
}
