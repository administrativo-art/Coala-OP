export interface SplitJourneySegment {
  id: string;
  unitId: string;
  startTime: string;
  endTime: string;
  manualOrder?: number | null;
  manualDay?: { mode: string; expectedBreakMinutes: number; expectedWorkMinutes?: number } | null;
  manualBreak?: { start: string; end: string } | null;
}

export function isWindowlessFlexibleShift(shift: Record<string, unknown>) {
  return Number.isInteger(shift.manualOrder) && (shift.manualDay as { mode?: string } | null)?.mode === 'flexible'
    && shift.startTime === '' && shift.endTime === '';
}

type SplitJourneyIssue = {
  segmentId: string;
  previousSegmentId?: string;
  code: 'invalid_time' | 'invalid_break' | 'overlap';
  message: string;
};

function minuteOfDay(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function reviewSplitJourney(segments: readonly SplitJourneySegment[]) {
  const explicitOrder = segments.every((segment) => segment.manualOrder != null);
  const ordered = [...segments].sort((left, right) => explicitOrder
    ? (left.manualOrder ?? 0) - (right.manualOrder ?? 0)
    : left.startTime.localeCompare(right.startTime));
  const changes: { fromId: string; toId: string; minutes: number | null }[] = [];
  const issues: SplitJourneyIssue[] = [];
  let workMinutes = 0;
  let breakMinutes = 0;
  let previous: { segment: SplitJourneySegment; end: number } | undefined;

  for (const [index, segment] of ordered.entries()) {
    const prior = ordered[index - 1];
    if (prior && prior.unitId !== segment.unitId) {
      const gap = minuteOfDay(segment.startTime) - minuteOfDay(prior.endTime);
      changes.push({ fromId: prior.id, toId: segment.id, minutes: gap >= 0 ? gap : null });
    }
    const flex = segment.manualOrder != null && segment.manualDay?.mode === 'flexible';
    if (flex && !segment.startTime && !segment.endTime && !segment.manualBreak) {
      workMinutes += segment.manualDay?.expectedWorkMinutes ?? 0;
      continue;
    }
    const start = minuteOfDay(segment.startTime);
    const end = minuteOfDay(segment.endTime);
    if (!(start < end)) {
      issues.push({ segmentId: segment.id, code: 'invalid_time',
        message: 'Informe início e fim válidos no mesmo dia.' });
      continue;
    }
    workMinutes += flex ? segment.manualDay?.expectedWorkMinutes ?? 0 : end - start;
    if (segment.manualBreak) {
      const breakStart = minuteOfDay(segment.manualBreak.start);
      const breakEnd = minuteOfDay(segment.manualBreak.end);
      if (!(start < breakStart && breakStart < breakEnd && breakEnd < end)) {
        issues.push({ segmentId: segment.id, code: 'invalid_break',
          message: 'O intervalo precisa começar e terminar dentro do trecho.' });
      } else {
        breakMinutes += breakEnd - breakStart;
        if (!flex) workMinutes -= breakEnd - breakStart;
      }
    }

    if (previous && start < previous.end) {
      issues.push({ segmentId: segment.id, previousSegmentId: previous.segment.id, code: 'overlap',
        message: 'Os horários dos trechos se sobrepõem.' });
    }

    if (!previous || previous.end < end) previous = { segment, end };
  }

  return { segments: ordered, issues, workMinutes, breakMinutes, changes, journeyMinutes: workMinutes };
}

export function validSplitJourneyShiftIds(shifts: readonly (SplitJourneySegment & {
  userId: string;
  date: string;
  manualDayId?: string | null;
})[]) {
  const days = new Map<string, Array<(typeof shifts)[number]>>();
  for (const shift of shifts) {
    const key = JSON.stringify([shift.userId, shift.date]);
    const periods = days.get(key) ?? [];
    periods.push(shift);
    days.set(key, periods);
  }

  const ids = new Set<string>();
  for (const periods of days.values()) {
    const first = periods[0];
    const configuration = first.manualDay;
    if (!first.manualDayId || !configuration || new Set(periods.map(({ unitId }) => unitId)).size < 2) continue;
    const ordered = periods.every((period) => period.manualOrder != null);
    if (ordered && new Set(periods.map((period) => period.manualOrder)).size !== periods.length) continue;
    if (periods.some((period) => period.manualDayId !== first.manualDayId || !period.manualDay
      || (!ordered && (period.manualDay.mode !== configuration.mode
      || period.manualDay.expectedBreakMinutes !== configuration.expectedBreakMinutes
      || period.manualDay.expectedWorkMinutes !== configuration.expectedWorkMinutes)))) continue;
    if (reviewSplitJourney(periods).issues.length) continue;
    periods.forEach(({ id }) => ids.add(id));
  }
  return ids;
}
