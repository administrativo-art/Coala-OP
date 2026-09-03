import { z } from 'zod';

import type { DPOperatingHours, DPShift } from '@/types';

export const DP_WEEKDAYS = [
  { key: '0', shortLabel: 'Dom', label: 'Domingo' },
  { key: '1', shortLabel: 'Seg', label: 'Segunda-feira' },
  { key: '2', shortLabel: 'Ter', label: 'Terça-feira' },
  { key: '3', shortLabel: 'Qua', label: 'Quarta-feira' },
  { key: '4', shortLabel: 'Qui', label: 'Quinta-feira' },
  { key: '5', shortLabel: 'Sex', label: 'Sexta-feira' },
  { key: '6', shortLabel: 'Sáb', label: 'Sábado' },
] as const;

export type DPWeekdayKey = (typeof DP_WEEKDAYS)[number]['key'];

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const closedDaySchema = z.object({ isOpen: z.literal(false) }).strict();
const openDaySchema = z.object({
  isOpen: z.literal(true),
  startTime: timeSchema,
  endTime: timeSchema,
}).strict().refine(
  (day) => timeToMinutes(day.endTime) > timeToMinutes(day.startTime),
  { message: 'O encerramento deve ser posterior à abertura.' },
);

const operatingDaySchema = z.union([closedDaySchema, openDaySchema]);

export const dpOperatingHoursSchema = z.object(
  Object.fromEntries(DP_WEEKDAYS.map(({ key }) => [key, operatingDaySchema])) as Record<
    DPWeekdayKey,
    typeof operatingDaySchema
  >,
).strict();

export function emptyOperatingHours(): DPOperatingHours {
  return Object.fromEntries(
    DP_WEEKDAYS.map(({ key }) => [key, { isOpen: false }]),
  ) as DPOperatingHours;
}

export function normalizeOperatingHours(value: DPOperatingHours | undefined): DPOperatingHours {
  const fallback = emptyOperatingHours();
  if (!value) return fallback;
  const parsed = dpOperatingHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function hasConfiguredOperatingHours(value: DPOperatingHours | undefined) {
  const parsed = dpOperatingHoursSchema.safeParse(value);
  return parsed.success && DP_WEEKDAYS.some(({ key }) => parsed.data[key].isOpen);
}

export function formatOperatingHoursSummary(value: DPOperatingHours | undefined) {
  if (!hasConfiguredOperatingHours(value)) return null;
  const normalized = normalizeOperatingHours(value);
  const openDays = DP_WEEKDAYS.filter(({ key }) => normalized[key].isOpen);
  const uniqueRanges = new Set(openDays.map(({ key }) => {
    const day = normalized[key];
    return day.isOpen ? `${day.startTime}–${day.endTime}` : '';
  }));
  if (openDays.length === 7 && uniqueRanges.size === 1) {
    return `Todos os dias · ${[...uniqueRanges][0]}`;
  }
  return openDays.map(({ key, shortLabel }) => {
    const day = normalized[key];
    return day.isOpen ? `${shortLabel} ${day.startTime}–${day.endTime}` : '';
  }).filter(Boolean).join(' · ');
}

export type DPCoverageGap = {
  startTime: string;
  endTime: string;
};

export type DPDailyCoverage = {
  date: string;
  configured: boolean;
  isOpen: boolean;
  startTime?: string;
  endTime?: string;
  gaps: DPCoverageGap[];
};

export function buildDailyUnitCoverage(params: {
  date: string;
  operatingHours?: DPOperatingHours;
  shifts: readonly Pick<DPShift, 'type' | 'date' | 'startTime' | 'endTime'>[];
}): DPDailyCoverage {
  const { date, operatingHours, shifts } = params;
  if (!operatingHours) return { date, configured: false, isOpen: false, gaps: [] };

  const weekday = String(new Date(`${date}T12:00:00.000Z`).getUTCDay()) as DPWeekdayKey;
  const day = normalizeOperatingHours(operatingHours)[weekday];
  if (!day.isOpen) return { date, configured: true, isOpen: false, gaps: [] };

  const opening = timeToMinutes(day.startTime);
  const closing = timeToMinutes(day.endTime);
  const ranges = shifts
    .filter((shift) => shift.type !== 'day_off' && shift.date === date)
    .flatMap((shift) => {
      const start = safeTimeToMinutes(shift.startTime);
      const end = safeTimeToMinutes(shift.endTime);
      if (start === null || end === null || end <= start) return [];
      const clippedStart = Math.max(opening, start);
      const clippedEnd = Math.min(closing, end);
      return clippedEnd > clippedStart ? [{ start: clippedStart, end: clippedEnd }] : [];
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const gaps: DPCoverageGap[] = [];
  let cursor = opening;
  for (const range of ranges) {
    if (range.start > cursor) {
      gaps.push({ startTime: minutesToTime(cursor), endTime: minutesToTime(range.start) });
    }
    cursor = Math.max(cursor, range.end);
    if (cursor >= closing) break;
  }
  if (cursor < closing) {
    gaps.push({ startTime: minutesToTime(cursor), endTime: minutesToTime(closing) });
  }

  return {
    date,
    configured: true,
    isOpen: true,
    startTime: day.startTime,
    endTime: day.endTime,
    gaps,
  };
}

function safeTimeToMinutes(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? timeToMinutes(value) : null;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
