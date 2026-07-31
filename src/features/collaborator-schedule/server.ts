import { dbAdmin } from "@/lib/firebase-admin";
import type { ServerUserContext } from "@/lib/auth-server";

const UNIT_TONES = [
  { color: "#db2777", tint: "#fce7f0", border: "#fbcfe8" },
  { color: "#7c3aed", tint: "#f1eafd", border: "#ddd0fb" },
  { color: "#0b76b7", tint: "#e3f1fa", border: "#c3e0f2" },
  { color: "#059669", tint: "#e8f8f1", border: "#bdebd8" },
  { color: "#d97706", tint: "#fff5df", border: "#f7ddb0" },
] as const;

function compactUnique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
    )
  );
}

function timestampMillis(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toneForUnit(unitId: string) {
  let hash = 0;
  for (let index = 0; index < unitId.length; index += 1) {
    hash = (hash * 31 + unitId.charCodeAt(index)) >>> 0;
  }
  return UNIT_TONES[hash % UNIT_TONES.length];
}

function monthBounds(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return {
    start: `${prefix}-01`,
    end: `${prefix}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function canAccessCollaboratorSchedule(access: ServerUserContext) {
  return (
    access.permissions.dashboard.collaborator === true ||
    access.permissions.dashboard.view === true
  );
}

export async function buildCollaboratorSchedulePayload(
  access: ServerUserContext,
  year: number,
  month: number
) {
  const user = access.userDoc;
  const pdvAccessIds = Array.isArray(user.pdvAccesses)
    ? user.pdvAccesses.map((entry) => entry.externalUserId)
    : [];
  const acceptedUserIds = new Set(
    compactUnique([
      access.decoded.uid,
      user.id,
      user.hrEmployeeId,
      user.registrationIdBizneo,
      user.registrationIdPdv,
      ...pdvAccessIds,
    ])
  );
  const { start, end } = monthBounds(year, month);

  const schedulesSnap = await dbAdmin
    .collection("dp_schedules")
    .where("year", "==", year)
    .where("month", "==", month)
    .get();

  // "Trancar" é hoje a confirmação operacional da escala. Escalas ainda
  // editáveis não podem aparecer no portal do colaborador.
  const publishedSchedules = schedulesSnap.docs
    .filter((doc) => doc.get("locked") === true)
    .sort(
      (left, right) =>
        timestampMillis(right.get("createdAt")) -
        timestampMillis(left.get("createdAt"))
    );

  // Se houver mais de uma escala confirmada para a mesma unidade, a mais
  // recente é a fonte oficial. Isso evita duplicar turnos históricos.
  const latestScheduleByUnit = new Map<string, (typeof publishedSchedules)[number]>();
  for (const schedule of publishedSchedules) {
    const scope = String(schedule.get("unitId") ?? "__legacy__");
    if (!latestScheduleByUnit.has(scope)) {
      latestScheduleByUnit.set(scope, schedule);
    }
  }

  const scheduleShiftGroups = await Promise.all(
    Array.from(latestScheduleByUnit.values()).map(async (scheduleDoc) => {
      const shiftsSnap = await scheduleDoc.ref.collection("shifts").get();
      const snapshot = scheduleDoc.get("snapshot") as
        | { users?: Record<string, { username?: string }> }
        | undefined;
      return {
        scheduleId: scheduleDoc.id,
        snapshotUsers: snapshot?.users ?? {},
        shifts: shiftsSnap.docs
          .map(
            (doc): Record<string, unknown> => ({
              id: doc.id,
              scheduleId: scheduleDoc.id,
              ...doc.data(),
            })
          )
          .filter((shift) => {
            const date = String(shift.date ?? "");
            return date >= start && date <= end;
          }),
      };
    })
  );

  const allPublishedShifts = scheduleShiftGroups.flatMap(
    (group) => group.shifts
  );
  const ownPublishedShifts = allPublishedShifts.filter((shift) =>
    acceptedUserIds.has(String(shift.userId ?? ""))
  );
  const linkedUnitIds = new Set(
    compactUnique([
      ...(Array.isArray(user.unitIds) ? user.unitIds : []),
      ...ownPublishedShifts.map((shift) => String(shift.unitId ?? "")),
    ])
  );
  const visibleTeamShifts = allPublishedShifts.filter((shift) =>
    linkedUnitIds.has(String(shift.unitId ?? ""))
  );

  const dedupedShifts = new Map<string, Record<string, unknown>>();
  for (const shift of ownPublishedShifts) {
    const key = [
      shift.date,
      shift.unitId,
      shift.startTime,
      shift.endTime,
      shift.type,
    ].join("|");
    if (!dedupedShifts.has(key)) {
      dedupedShifts.set(key, shift);
    }
  }

  const shifts = Array.from(dedupedShifts.values()).sort((left, right) =>
    `${left.date ?? ""} ${left.startTime ?? ""}`.localeCompare(
      `${right.date ?? ""} ${right.startTime ?? ""}`
    )
  );
  const dedupedTeamShifts = new Map<string, Record<string, unknown>>();
  for (const shift of visibleTeamShifts) {
    const key = [
      shift.userId,
      shift.date,
      shift.unitId,
      shift.startTime,
      shift.endTime,
      shift.type,
    ].join("|");
    if (!dedupedTeamShifts.has(key)) {
      dedupedTeamShifts.set(key, shift);
    }
  }
  const teamShifts = Array.from(dedupedTeamShifts.values()).sort(
    (left, right) =>
      `${left.date ?? ""} ${left.startTime ?? ""}`.localeCompare(
        `${right.date ?? ""} ${right.startTime ?? ""}`
      )
  );
  const unitIds = compactUnique(
    [...shifts, ...teamShifts].map((shift) => String(shift.unitId ?? ""))
  );
  const definitionIds = compactUnique(
    [...shifts, ...teamShifts].map((shift) =>
      String(shift.shiftDefinitionId ?? "")
    )
  );
  const teamUserIds = compactUnique(
    teamShifts.map((shift) => String(shift.userId ?? ""))
  );

  const [unitDocs, definitionDocs, teamUserDocs] = await Promise.all([
    unitIds.length > 0
      ? dbAdmin.getAll(
          ...unitIds.map((id) => dbAdmin.collection("dp_units").doc(id))
        )
      : Promise.resolve([]),
    definitionIds.length > 0
      ? dbAdmin.getAll(
          ...definitionIds.map((id) =>
            dbAdmin.collection("dp_shiftDefinitions").doc(id)
          )
        )
      : Promise.resolve([]),
    teamUserIds.length > 0
      ? dbAdmin.getAll(
          ...teamUserIds.map((id) => dbAdmin.collection("users").doc(id))
        )
      : Promise.resolve([]),
  ]);

  const units = new Map(
    unitDocs.map((doc) => [
      doc.id,
      {
        name: String(doc.get("name") ?? "Unidade não definida"),
        tone: toneForUnit(doc.id),
      },
    ])
  );
  const definitions = new Map(
    definitionDocs.map((doc) => [
      doc.id,
      String(doc.get("name") ?? "Turno"),
    ])
  );
  const snapshotNames = new Map<string, string>();
  for (const group of scheduleShiftGroups) {
    for (const [userId, snapshotUser] of Object.entries(
      group.snapshotUsers
    )) {
      const username =
        typeof snapshotUser?.username === "string"
          ? snapshotUser.username.trim()
          : "";
      if (username && !snapshotNames.has(userId)) {
        snapshotNames.set(userId, username);
      }
    }
  }
  const teamMembers = new Map(
    teamUserIds.map((userId, index) => {
      const doc = teamUserDocs[index];
      const functionNames = doc?.get("jobFunctionNames");
      const role =
        doc?.get("jobRoleName") ??
        (Array.isArray(functionNames) ? functionNames[0] : "");
      return [
        userId,
        {
          name: String(
            doc?.get("username") ??
              snapshotNames.get(userId) ??
              "Colaborador"
          ),
          role:
            typeof role === "string" && role.trim()
              ? role.trim()
              : "Colaborador",
        },
      ];
    })
  );

  function enrichShift(shift: Record<string, unknown>) {
    const unitId = String(shift.unitId ?? "");
    const definitionId = String(shift.shiftDefinitionId ?? "");
    const unit = units.get(unitId) ?? {
      name: "Unidade não definida",
      tone: toneForUnit(unitId || "unassigned"),
    };
    return {
      id: String(shift.id ?? ""),
      scheduleId: String(shift.scheduleId ?? ""),
      unitId,
      unitName: unit.name,
      unitTone: unit.tone,
      shiftDefinitionId: definitionId || null,
      shiftName:
        shift.type === "day_off"
          ? "Folga"
          : definitions.get(definitionId) ?? "Turno",
      date: String(shift.date ?? ""),
      startTime: String(shift.startTime ?? ""),
      endTime: String(shift.endTime ?? ""),
      type: shift.type === "day_off" ? ("day_off" as const) : ("work" as const),
    };
  }

  return {
    year,
    month,
    published: latestScheduleByUnit.size > 0,
    shifts: shifts.map(enrichShift),
    teamUnits: unitIds
      .filter((unitId) => linkedUnitIds.has(unitId))
      .map((unitId) => {
        const unit = units.get(unitId) ?? {
          name: "Unidade não definida",
          tone: toneForUnit(unitId),
        };
        return {
          id: unitId,
          name: unit.name,
          tone: unit.tone,
          shifts: teamShifts
            .filter((shift) => String(shift.unitId ?? "") === unitId)
            .map((shift) => {
              const shiftUserId = String(shift.userId ?? "");
              const member = teamMembers.get(shiftUserId) ?? {
                name: snapshotNames.get(shiftUserId) ?? "Colaborador",
                role: "Colaborador",
              };
              return {
                ...enrichShift(shift),
                userId: shiftUserId,
                employeeName: member.name,
                employeeRole: member.role,
                isCurrentUser: acceptedUserIds.has(shiftUserId),
              };
            }),
        };
      }),
  };
}
