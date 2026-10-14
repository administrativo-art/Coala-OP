import type { DPJourney, DPShiftDefinition } from '@/types';

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function elapsedMinutes(start: string, end: string, crossesMidnight = false) {
  const startMinutes = timeToMinutes(start);
  let endMinutes = timeToMinutes(end);
  if (crossesMidnight || endMinutes < startMinutes) endMinutes += 24 * 60;
  return Math.max(0, endMinutes - startMinutes);
}

export function shiftDurationSummary(definition: Pick<
  DPShiftDefinition,
  'startTime' | 'endTime' | 'overnight' | 'breakType' | 'breakStart' | 'breakEnd' | 'breakDurationMinutes'
>) {
  const grossMinutes = elapsedMinutes(definition.startTime, definition.endTime, definition.overnight === true);
  const breakType = definition.breakType
    ?? (definition.breakStart && definition.breakEnd ? 'fixed' : 'none');
  const breakMinutes = breakType === 'fixed' && definition.breakStart && definition.breakEnd
    ? elapsedMinutes(definition.breakStart, definition.breakEnd)
    : breakType === 'flexible' || breakType === 'staggered'
      ? definition.breakDurationMinutes ?? 0
      : 0;
  return {
    grossMinutes,
    breakMinutes,
    workedMinutes: Math.max(0, grossMinutes - breakMinutes),
  };
}

export function journeyWorkMinuteOptions(journey: Pick<DPJourney, 'days'>) {
  return [...new Set(journey.days
    .filter((day) => !day.isRestDay && day.plannedMinutes > 0)
    .map((day) => day.plannedMinutes))]
    .sort((left, right) => left - right);
}

export function defaultExpectedBreakMinutes(plannedWorkMinutes: number) {
  if (plannedWorkMinutes > 6 * 60) return 60;
  if (plannedWorkMinutes > 4 * 60) return 15;
  return 0;
}

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function shiftJourneyComparisons(
  definition: Pick<
    DPShiftDefinition,
    'startTime' | 'endTime' | 'overnight' | 'breakType' | 'breakStart' | 'breakEnd' | 'breakDurationMinutes'
  >,
  journey: Pick<DPJourney, 'days' | 'expectedBreakMinutes'>,
) {
  const defined = shiftDurationSummary(definition);
  const startMinutes = timeToMinutes(definition.startTime);
  return journeyWorkMinuteOptions(journey).map((expectedWorkMinutes) => {
    const expectedBreakMinutes = journey.expectedBreakMinutes
      ?? defaultExpectedBreakMinutes(expectedWorkMinutes);
    const expectedGrossMinutes = expectedWorkMinutes + expectedBreakMinutes;
    return {
      defined,
      expectedStartTime: definition.startTime,
      expectedEndTime: minutesToTime(startMinutes + expectedGrossMinutes),
      expectedOvernight: startMinutes + expectedGrossMinutes >= 24 * 60,
      expectedWorkMinutes,
      expectedBreakMinutes,
      expectedGrossMinutes,
      endsBeforeExpected: defined.grossMinutes < expectedGrossMinutes,
    };
  });
}

export function formatShiftMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h${String(remainder).padStart(2, '0')}`;
}
