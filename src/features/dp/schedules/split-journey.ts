export interface SplitJourneySegment {
  id: string;
  unitId: string;
  startTime: string;
  endTime: string;
  manualBreak?: { start: string; end: string } | null;
  travelFromPreviousMinutes?: number | null;
}

type SplitJourneyIssue = {
  segmentId: string;
  previousSegmentId?: string;
  code: 'invalid_time' | 'invalid_break' | 'overlap' | 'invalid_travel' | 'insufficient_travel';
  message: string;
};

function minuteOfDay(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function reviewSplitJourney(segments: readonly SplitJourneySegment[]) {
  const ordered = [...segments].sort((left, right) => left.startTime.localeCompare(right.startTime));
  const issues: SplitJourneyIssue[] = [];
  let workMinutes = 0;
  let breakMinutes = 0;
  let travelMinutes = 0;
  let previous: { segment: SplitJourneySegment; end: number } | undefined;

  for (const segment of ordered) {
    const start = minuteOfDay(segment.startTime);
    const end = minuteOfDay(segment.endTime);
    if (!(start < end)) {
      issues.push({ segmentId: segment.id, code: 'invalid_time',
        message: 'Informe início e fim válidos no mesmo dia.' });
      continue;
    }
    workMinutes += end - start;
    if (segment.manualBreak) {
      const breakStart = minuteOfDay(segment.manualBreak.start);
      const breakEnd = minuteOfDay(segment.manualBreak.end);
      if (!(start < breakStart && breakStart < breakEnd && breakEnd < end)) {
        issues.push({ segmentId: segment.id, code: 'invalid_break',
          message: 'O intervalo precisa começar e terminar dentro do trecho.' });
      } else {
        breakMinutes += breakEnd - breakStart;
        workMinutes -= breakEnd - breakStart;
      }
    }

    const travel = segment.travelFromPreviousMinutes;
    if (previous && start < previous.end) {
      issues.push({ segmentId: segment.id, previousSegmentId: previous.segment.id, code: 'overlap',
        message: 'Os horários dos trechos se sobrepõem.' });
    } else if (previous && previous.segment.unitId !== segment.unitId) {
      const available = start - previous.end;
      if (travel == null || !Number.isInteger(travel) || travel < 0) {
        issues.push({ segmentId: segment.id, previousSegmentId: previous.segment.id, code: 'invalid_travel',
          message: 'Informe o tempo de deslocamento entre as unidades.' });
      } else if (travel > available) {
        issues.push({ segmentId: segment.id, previousSegmentId: previous.segment.id, code: 'insufficient_travel',
          message: `${available} min disponíveis para um deslocamento de ${travel} min.` });
      } else {
        travelMinutes += travel;
      }
    } else if (travel != null && travel !== 0) {
      issues.push({ segmentId: segment.id, code: 'invalid_travel',
        message: 'Informe deslocamento apenas entre trechos de unidades diferentes.' });
    }

    if (!previous || previous.end < end) previous = { segment, end };
  }

  return { segments: ordered, issues, workMinutes, breakMinutes, travelMinutes,
    journeyMinutes: workMinutes + travelMinutes };
}
