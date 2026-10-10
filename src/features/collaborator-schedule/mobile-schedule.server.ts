import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { matchDPUnitForKiosk } from "@/lib/dp-kiosk-match";
import { AppError } from "@/lib/observability/app-error";
import type { DPUnit } from "@/types";
import { buildCollaboratorSchedulePayload } from "./server";
import { safeAvatarUrl, toMobileSchedule } from "./mobile-schedule";

function failure(code: string, safeMessage: string): never {
  throw new AppError({ code: `MOBILE_SCHEDULE_${code}`, kind: "AUTHORIZATION", safeMessage });
}

/** Permission from the app list; the web collaborator panel does not grant it here. */
export function assertCanViewMobileSchedule(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && actor.permissions.app?.schedule?.view !== true) failure("FORBIDDEN", "Sua conta não possui permissão para ver a escala pelo aplicativo.");
}

/**
 * The published schedule of the units this person belongs to, by the same rule as the web
 * collaborator schedule: only locked schedules, units linked to the person or to their own shifts.
 */
export async function loadMobileSchedule(actor: ServerUserContext, year: number, month: number) {
  assertCanViewMobileSchedule(actor);
  const payload = await buildCollaboratorSchedulePayload(actor, year, month);
  const userIds = [...new Set(payload.teamUnits.flatMap((unit) => unit.shifts.map((shift) => shift.userId)).filter(Boolean))];
  const snapshots = userIds.length ? await dbAdmin.getAll(...userIds.map((id) => dbAdmin.collection("users").doc(id))) : [];
  return toMobileSchedule(payload, new Map(snapshots.map((snapshot) => [snapshot.id, safeAvatarUrl(snapshot.get("avatarUrl"))])));
}

const UNITS_TTL_MS = 10 * 60_000;
let dpUnitsCache: { expiresAt: number; value: Promise<DPUnit[]> } | null = null;

function dpUnits() {
  if (dpUnitsCache && dpUnitsCache.expiresAt > Date.now()) return dpUnitsCache.value;
  const entry = { expiresAt: Date.now() + UNITS_TTL_MS, value: dbAdmin.collection("dp_units").limit(300).get()
    .then((snapshot) => snapshot.docs.map((document) => ({ ...(document.data() as DPUnit), id: document.id }))) };
  entry.value.catch(() => { if (dpUnitsCache === entry) dpUnitsCache = null; });
  dpUnitsCache = entry;
  return entry.value;
}

/**
 * Days a "scheduled days" goal is distributed over, as the web goals panel derives them: dates in
 * the period on which a goal participant has a work shift in the schedules of that unit. An empty
 * result means "use calendar days", the same fallback the web applies.
 */
export async function loadScheduledGoalDateKeys(input: { kioskName: string; startKey: string; endKey: string; employeeIds: string[] }) {
  if (!input.employeeIds.length) return [];
  const unit = matchDPUnitForKiosk(input.kioskName, await dpUnits());
  const months = new Set([input.startKey.slice(0, 7), input.endKey.slice(0, 7)]);
  const schedules = (await Promise.all([...months].map((key) =>
    dbAdmin.collection("dp_schedules").where("year", "==", Number(key.slice(0, 4))).where("month", "==", Number(key.slice(5, 7))).get())))
    .flatMap((snapshot) => snapshot.docs)
    // A schedule tied to another unit never counts; legacy schedules without a unit serve every unit.
    .filter((document) => !document.get("unitId") || !unit || document.get("unitId") === unit.id);
  const dates = new Set<string>();
  for (const schedule of schedules) {
    for (let index = 0; index < input.employeeIds.length; index += 30) {
      const shifts = await schedule.ref.collection("shifts").where("userId", "in", input.employeeIds.slice(index, index + 30)).get();
      for (const shift of shifts.docs) {
        const date = String(shift.get("date") ?? "");
        if (shift.get("type") === "work" && date >= input.startKey && date <= input.endKey) dates.add(date);
      }
    }
  }
  return [...dates].sort();
}

/** The signed-in person's own card: name, role and photo, exactly as registered in Coala One. */
export function mobileProfile(actor: ServerUserContext) {
  const user = actor.userDoc as unknown as Record<string, unknown>;
  const functions = user.jobFunctionNames;
  const role = typeof user.jobRoleName === "string" && user.jobRoleName.trim() ? user.jobRoleName.trim()
    : Array.isArray(functions) && typeof functions[0] === "string" ? functions[0] : null;
  return {
    name: String(user.username || actor.decoded.email || "Usuário"),
    email: typeof actor.decoded.email === "string" ? actor.decoded.email : null,
    role,
    avatarUrl: safeAvatarUrl(user.avatarUrl),
  };
}
