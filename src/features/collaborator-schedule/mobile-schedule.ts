/** Only https photo links leave the server; anything else is treated as "no photo". */
export function safeAvatarUrl(value: unknown) {
  return typeof value === "string" && /^https:\/\/[^\s]+$/.test(value.trim()) && value.length <= 2000 ? value.trim() : null;
}

export function parseSchedulePeriod(yearRaw: string | null, monthRaw: string | null, today: string) {
  const currentYear = Number(today.slice(0, 4));
  const year = yearRaw === null ? currentYear : Number(yearRaw);
  const month = monthRaw === null ? Number(today.slice(5, 7)) : Number(monthRaw);
  // Same bounds as the web collaborator schedule.
  if (!Number.isInteger(year) || year < 2020 || year > currentYear + 2 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

type TeamShift = {
  date: string; startTime: string; endTime: string; type: "work" | "day_off"; shiftName: string;
  userId: string; employeeName: string; employeeRole: string; isCurrentUser: boolean;
};

/**
 * Shapes the web collaborator-schedule payload for the phone: per unit, the people (once each,
 * with photo) and their shifts by person index, so internal ids never reach the app.
 */
export function toMobileSchedule(
  payload: { year: number; month: number; published: boolean; teamUnits: Array<{ id: string; name: string; shifts: TeamShift[] }> },
  avatarByUserId: Map<string, string | null>,
) {
  return {
    year: payload.year,
    month: payload.month,
    published: payload.published,
    units: payload.teamUnits.map((unit) => {
      const order: string[] = [];
      for (const shift of unit.shifts) if (!order.includes(shift.userId)) order.push(shift.userId);
      // The person looking at the schedule comes first; colleagues follow by name.
      const people = order
        .map((userId) => {
          const sample = unit.shifts.find((shift) => shift.userId === userId)!;
          return { userId, name: sample.employeeName, role: sample.employeeRole, isMe: sample.isCurrentUser, avatarUrl: avatarByUserId.get(userId) ?? null };
        })
        .sort((left, right) => Number(right.isMe) - Number(left.isMe) || left.name.localeCompare(right.name, "pt-BR"));
      const indexByUser = new Map(people.map((person, index) => [person.userId, index]));
      return {
        id: unit.id,
        name: unit.name,
        people: people.map(({ userId: _userId, ...person }) => person),
        shifts: unit.shifts.map((shift) => ({
          person: indexByUser.get(shift.userId)!, date: shift.date, startTime: shift.startTime, endTime: shift.endTime, type: shift.type, shiftName: shift.shiftName,
        })),
      };
    }),
  };
}
