type Day = { date: string; week: number };
type ShiftRef = { id: string; userId: string };

/** Only shifts rendered in expanded weeks may be selected by the visible-selection action. */
export function buildVisibleSchedulePeople(
  days: readonly Day[],
  collapsedWeeks: ReadonlySet<number>,
  shiftsByDateAndUnit: Record<string, Record<string, readonly ShiftRef[]>>,
  namesByUser: ReadonlyMap<string, { username: string }>,
) {
  const idsByUser = new Map<string, Set<string>>();
  for (const day of days) {
    if (collapsedWeeks.has(day.week)) continue;
    for (const shifts of Object.values(shiftsByDateAndUnit[day.date] ?? {})) {
      for (const shift of shifts) {
        const ids = idsByUser.get(shift.userId) ?? new Set<string>();
        ids.add(shift.id);
        idsByUser.set(shift.userId, ids);
      }
    }
  }
  return Array.from(idsByUser, ([id, shiftIds]) => ({
    id,
    name: namesByUser.get(id)?.username ?? id,
    shiftIds: Array.from(shiftIds),
  })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}
