import type { DPShift, DPShiftDefinition, DPUnit } from '@/types';
import { getShiftDefinitionUnitIds, shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { hasConfiguredOperatingHours, normalizeOperatingHours } from '@/lib/dp-operating-hours';

export function countFilledDPShiftDays(shifts: Array<Pick<DPShift, 'type' | 'date'>>) {
  return new Set(shifts.flatMap((shift) => (
    shift.type === 'day_off' || !shift.date ? [] : [shift.date]
  ))).size;
}

/**
 * Returns an expected-day count from operating hours or shift definitions, independently
 * of the empty-schedule alert configured on the unit.
 */
export function countExpectedDPUnitDays({
  unit,
  year,
  month,
  shiftDefinitions,
  closedDates = [],
}: {
  unit: DPUnit;
  year: number;
  month: number;
  shiftDefinitions: DPShiftDefinition[];
  closedDates?: readonly string[];
}) {
  const exactDefinitions = shiftDefinitions.filter((definition) => (
    getShiftDefinitionUnitIds(definition).includes(unit.id)
  ));
  const definitions = exactDefinitions.length > 0
    ? exactDefinitions
    : shiftDefinitions.filter((definition) => (
      getShiftDefinitionUnitIds(definition).length === 0
      && shiftDefinitionMatchesUnit(definition, unit.id)
    ));

  const closed = new Set(closedDates);
  const isClosed = (day: number) => closed.has(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  const daysInMonth = new Date(year, month, 0).getDate();
  if (hasConfiguredOperatingHours(unit.operatingHours)) {
    const operatingHours = normalizeOperatingHours(unit.operatingHours);
    let openDays = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      if (isClosed(day)) continue;
      const weekday = new Date(year, month - 1, day, 12).getDay();
      if (operatingHours[String(weekday) as keyof typeof operatingHours].isOpen) openDays += 1;
    }
    return openDays;
  }

  if (definitions.length > 0) {
    let expectedDays = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      if (isClosed(day)) continue;
      const weekday = new Date(year, month - 1, day, 12).getDay();
      if (definitions.some((definition) => (
        !definition.daysOfWeek?.length || definition.daysOfWeek.includes(weekday)
      ))) expectedDays += 1;
    }
    return expectedDays;
  }

  return null;
}
