import { z } from 'zod';

import type {
  DPCoverageDemandWindow,
  DPCoverageDemands,
  DPCoverageMode,
  DPShift,
  DPUnit,
} from '@/types';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const dpCoverageModeSchema = z.enum(['fixed_hours', 'on_demand', 'disabled']);

export const coverageDemandWindowSchema = z.object({
  startTime: timeSchema,
  endTime: timeSchema,
  minimumPeople: z.coerce.number().int().min(1).max(50),
  reason: z.string().trim().max(160).optional(),
}).strict().refine(
  (window) => window.endTime > window.startTime,
  { message: 'O encerramento da demanda deve ser posterior ao início.' },
);

export const coverageDemandWindowsSchema = z.array(coverageDemandWindowSchema)
  .max(12)
  .superRefine((windows, context) => {
    const sorted = [...windows].sort((left, right) => left.startTime.localeCompare(right.startTime));
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startTime < sorted[index - 1].endTime) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Os intervalos de demanda não podem se sobrepor.',
        });
        return;
      }
    }
  });

export const saveCoverageDemandsSchema = z.object({
  unitId: z.string().trim().min(1).max(180),
  windows: coverageDemandWindowsSchema,
}).strict();

export const coverageDemandRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, 'Data inválida.'),
});

export type SaveCoverageDemandsInput = z.infer<typeof saveCoverageDemandsSchema>;

export type DPCoverageGap = {
  startTime: string;
  endTime: string;
  requiredPeople?: number;
  scheduledPeople?: number;
};

export type DPDailyCoverage = {
  date: string;
  mode: Exclude<DPCoverageMode, 'disabled'>;
  configured: boolean;
  isOpen: boolean;
  hasDemand: boolean;
  hasUnplannedShifts: boolean;
  startTime?: string;
  endTime?: string;
  windows: DPCoverageDemandWindow[];
  gaps: DPCoverageGap[];
};

export function resolveDPCoverageMode(
  unit: Pick<DPUnit, 'coverageMode'> | null | undefined,
): DPCoverageMode {
  return dpCoverageModeSchema.safeParse(unit?.coverageMode).data ?? 'fixed_hours';
}

export function normalizeDPCoverageDemands(value: unknown): DPCoverageDemands {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([date, windows]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const parsed = coverageDemandWindowsSchema.safeParse(windows);
      return parsed.success && parsed.data.length > 0
        ? [[date, parsed.data] as const]
        : [];
    }),
  );
}

export function buildDailyOnDemandCoverage(params: {
  date: string;
  windows: readonly DPCoverageDemandWindow[];
  shifts: readonly Pick<DPShift, 'type' | 'date' | 'startTime' | 'endTime' | 'userId'>[];
}): DPDailyCoverage {
  const { date, shifts } = params;
  const parsedWindows = coverageDemandWindowsSchema.safeParse(params.windows);
  const windows = parsedWindows.success
    ? [...parsedWindows.data].sort((left, right) => left.startTime.localeCompare(right.startTime))
    : [];
  const dailyWorkShifts = shifts.flatMap((shift) => {
    if (shift.type === 'day_off' || shift.date !== date) return [];
    const start = safeTimeToMinutes(shift.startTime);
    const end = safeTimeToMinutes(shift.endTime);
    if (start === null || end === null || end <= start) return [];
    return [{ ...shift, start, end }];
  });

  if (windows.length === 0) {
    return {
      date,
      mode: 'on_demand',
      configured: true,
      isOpen: false,
      hasDemand: false,
      hasUnplannedShifts: dailyWorkShifts.length > 0,
      windows: [],
      gaps: [],
    };
  }

  const gaps: DPCoverageGap[] = [];
  windows.forEach((window) => {
    const demandStart = timeToMinutes(window.startTime);
    const demandEnd = timeToMinutes(window.endTime);
    const boundaries = new Set([demandStart, demandEnd]);
    dailyWorkShifts.forEach((shift) => {
      if (shift.end <= demandStart || shift.start >= demandEnd) return;
      boundaries.add(Math.max(demandStart, shift.start));
      boundaries.add(Math.min(demandEnd, shift.end));
    });
    const points = [...boundaries].sort((left, right) => left - right);

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const scheduledPeople = new Set(
        dailyWorkShifts
          .filter((shift) => shift.start <= start && shift.end >= end)
          .map((shift) => shift.userId),
      ).size;
      if (scheduledPeople >= window.minimumPeople) continue;

      const previous = gaps.at(-1);
      if (
        previous
        && previous.endTime === minutesToTime(start)
        && previous.requiredPeople === window.minimumPeople
        && previous.scheduledPeople === scheduledPeople
      ) {
        previous.endTime = minutesToTime(end);
      } else {
        gaps.push({
          startTime: minutesToTime(start),
          endTime: minutesToTime(end),
          requiredPeople: window.minimumPeople,
          scheduledPeople,
        });
      }
    }
  });

  return {
    date,
    mode: 'on_demand',
    configured: true,
    isOpen: true,
    hasDemand: true,
    hasUnplannedShifts: false,
    startTime: windows[0].startTime,
    endTime: windows.at(-1)?.endTime,
    windows,
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

function isCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
