import type { DPShift, DPShiftDefinition, DPUnit } from '@/types';
import { getShiftDefinitionUnitIds, shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { resolveDPCoverageMode } from '@/lib/dp-coverage-demands';
import { hasConfiguredOperatingHours, normalizeOperatingHours } from '@/lib/dp-operating-hours';

export function countFilledDPShiftDays(shifts: Array<Pick<DPShift, 'type' | 'date'>>) {
  return new Set(shifts.flatMap((shift) => (
    shift.type === 'day_off' || !shift.date ? [] : [shift.date]
  ))).size;
}

/**
 * Returns the number of operating days expected to be filled for a fixed-hours unit.
 * On-demand units intentionally return null because they do not have a fixed target.
 */
export function countExpectedDPUnitDays({
  unit,
  year,
  month,
  shiftDefinitions,
}: {
  unit: DPUnit;
  year: number;
  month: number;
  shiftDefinitions: DPShiftDefinition[];
}) {
  if (resolveDPCoverageMode(unit) !== 'fixed_hours') return null;

  const exactDefinitions = shiftDefinitions.filter((definition) => (
    getShiftDefinitionUnitIds(definition).includes(unit.id)
  ));
  const definitions = exactDefinitions.length > 0
    ? exactDefinitions
    : shiftDefinitions.filter((definition) => (
      getShiftDefinitionUnitIds(definition).length === 0
      && shiftDefinitionMatchesUnit(definition, unit.id)
    ));

  const daysInMonth = new Date(year, month, 0).getDate();
  if (hasConfiguredOperatingHours(unit.operatingHours)) {
    const operatingHours = normalizeOperatingHours(unit.operatingHours);
    let openDays = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const weekday = new Date(year, month - 1, day, 12).getDay();
      if (operatingHours[String(weekday) as keyof typeof operatingHours].isOpen) openDays += 1;
    }
    return openDays;
  }

  if (definitions.length > 0) {
    let expectedDays = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const weekday = new Date(year, month - 1, day, 12).getDay();
      if (definitions.some((definition) => (
        !definition.daysOfWeek?.length || definition.daysOfWeek.includes(weekday)
      ))) expectedDays += 1;
    }
    return expectedDays;
  }

  return null;
}
