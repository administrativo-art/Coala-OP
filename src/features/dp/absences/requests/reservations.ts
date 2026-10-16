import type { AbsenceRequestPreviewInput } from './schemas';
import type { DPAbsencePolicy } from '@/types';

export type AbsenceDaySegment = { date: string; fromMinute: number; toMinute: number; quantityMinor: number; periodKey: string };
const DAY_MS = 86_400_000;
const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / DAY_MS;
const dateAt = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function absenceDaySegments(input: AbsenceRequestPreviewInput, policy: DPAbsencePolicy): AbsenceDaySegment[] {
  const start = dayNumber(input.startDate);
  const end = dayNumber(input.endDate);
  const finalAbsent = input.unit === 'day' && policy.calculation === 'calendar_days_until_return' ? end - 1 : end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || finalAbsent < start || finalAbsent - start + 1 > 180) {
    throw new Error('Período persistente indisponível ou superior a 180 dias.');
  }
  const result: AbsenceDaySegment[] = [];
  for (let day = start; day <= finalAbsent; day += 1) {
    const date = dateAt(day);
    const fromMinute = input.unit === 'hour' && day === start ? minute(input.startTime!) : 0;
    const toMinute = input.unit === 'hour' && day === end ? minute(input.endTime!) : 1440;
    if (toMinute <= fromMinute) continue;
    result.push({ date, fromMinute, toMinute,
      quantityMinor: input.unit === 'day' ? 1 : toMinute - fromMinute,
      periodKey: policy.limitPeriod === 'month' ? date.slice(0, 7) : date.slice(0, 4),
    });
  }
  if (!result.length) throw new Error('Período sem quantidade.');
  return result;
}

export function segmentBalances(segments: AbsenceDaySegment[]) {
  const result = new Map<string, number>();
  for (const segment of segments) result.set(segment.periodKey, (result.get(segment.periodKey) ?? 0) + segment.quantityMinor);
  return result;
}

export function intervalsOverlap(a: Pick<AbsenceDaySegment, 'fromMinute' | 'toMinute'>, b: Pick<AbsenceDaySegment, 'fromMinute' | 'toMinute'>) {
  return a.fromMinute < b.toMinute && b.fromMinute < a.toMinute;
}
