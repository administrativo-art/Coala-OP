import { z } from 'zod';

import { natashaRosterSnapshotSchema, type NatashaRosterSnapshot } from './natasha-roster-validator';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const idSchema = z.string().trim().min(1).max(180);

const windowSchema = z.object({
  startTime: timeSchema,
  endTime: timeSchema,
  minimumPeople: z.number().int().min(1).max(50),
}).strict().refine((window) => window.endTime > window.startTime, {
  path: ['endTime'], message: 'O fim precisa ser posterior ao início.',
});

const daySchema = z.discriminatedUnion('status', [
  z.object({ date: dateSchema, status: z.literal('closed'), windows: z.tuple([]) }).strict(),
  z.object({ date: dateSchema, status: z.literal('open'), windows: z.array(windowSchema).min(1).max(12) }).strict(),
]);

export const natashaCoveragePlanSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  expectedUnitIds: z.array(idSchema).min(1).max(5),
  scopeConfirmed: z.boolean(),
  units: z.array(z.object({
    unitId: idSchema,
    days: z.array(daySchema).max(31),
  }).strict()).max(5),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.expectedUnitIds).size !== plan.expectedUnitIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedUnitIds'], message: 'Unidades repetidas.' });
  }
  const seenUnits = new Set<string>();
  for (const [unitIndex, unit] of plan.units.entries()) {
    if (seenUnits.has(unit.unitId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['units', unitIndex, 'unitId'], message: 'Unidade repetida.' });
    }
    seenUnits.add(unit.unitId);
    const seenDates = new Set<string>();
    for (const [dayIndex, day] of unit.days.entries()) {
      if (seenDates.has(day.date)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['units', unitIndex, 'days', dayIndex, 'date'], message: 'Data repetida.' });
      }
      seenDates.add(day.date);
      if (day.status !== 'open') continue;
      const sorted = [...day.windows].sort((left, right) => left.startTime.localeCompare(right.startTime));
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].startTime < sorted[index - 1].endTime) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['units', unitIndex, 'days', dayIndex, 'windows'], message: 'Janelas de demanda sobrepostas.' });
          break;
        }
      }
    }
  }
});

export type NatashaCoveragePlan = z.infer<typeof natashaCoveragePlanSchema>;
export type NatashaCoverageIssue = {
  code: 'SCOPE_UNCONFIRMED' | 'PERIOD_MISMATCH' | 'UNIT_UNDECLARED' | 'UNIT_MISSING' | 'DAY_MISSING' | 'DAY_OUTSIDE_PERIOD' | 'SHIFT_OUTSIDE_SCOPE' | 'SHIFT_ON_CLOSED_DAY' | 'COVERAGE_GAP';
  category: 'data' | 'coverage';
  unitId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  requiredPeople?: number;
  scheduledPeople?: number;
};

export type NatashaCoverageReport = {
  period: string;
  status: 'checked' | 'incomplete' | 'gaps';
  scope: 'confirmed_daily_windows_only';
  issues: NatashaCoverageIssue[];
  checkedWindows: number;
};

function minutes(time: string): number {
  const [hours, remainder] = time.split(':').map(Number);
  return hours * 60 + remainder;
}

function time(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function datesInMonth(period: string): string[] {
  const [year, month] = period.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`);
}

/** Conferência da demanda confirmada, independente das regras de jornada. */
export function validateNatashaCoverage(snapshot: NatashaRosterSnapshot, plan: NatashaCoveragePlan): NatashaCoverageReport {
  natashaRosterSnapshotSchema.parse(snapshot);
  natashaCoveragePlanSchema.parse(plan);
  const issues: NatashaCoverageIssue[] = [];
  const expected = new Set(plan.expectedUnitIds);
  const days = datesInMonth(plan.period);
  const inMonth = new Set(days);
  let checkedWindows = 0;
  if (!plan.scopeConfirmed) issues.push({ code: 'SCOPE_UNCONFIRMED', category: 'data' });
  if (snapshot.period !== plan.period) issues.push({ code: 'PERIOD_MISMATCH', category: 'data' });

  for (const unit of plan.units) {
    if (!expected.has(unit.unitId)) issues.push({ code: 'UNIT_UNDECLARED', category: 'data', unitId: unit.unitId });
  }
  for (const unitId of expected) {
    const unit = plan.units.find((item) => item.unitId === unitId);
    if (!unit) {
      issues.push({ code: 'UNIT_MISSING', category: 'data', unitId });
      continue;
    }
    const byDate = new Map(unit.days.map((day) => [day.date, day]));
    for (const day of unit.days) {
      if (!inMonth.has(day.date)) issues.push({ code: 'DAY_OUTSIDE_PERIOD', category: 'data', unitId, date: day.date });
    }
    for (const date of days) {
      const day = byDate.get(date);
      if (!day) {
        issues.push({ code: 'DAY_MISSING', category: 'data', unitId, date });
        continue;
      }
      const shifts = snapshot.shifts.filter((shift) => shift.unitId === unitId && shift.date === date);
      if (day.status === 'closed') {
        if (shifts.length > 0) issues.push({ code: 'SHIFT_ON_CLOSED_DAY', category: 'data', unitId, date });
        continue;
      }
      for (const window of day.windows) {
        checkedWindows += 1;
        const start = minutes(window.startTime);
        const end = minutes(window.endTime);
        const relevant = shifts.filter((shift) => minutes(shift.startTime) < end && minutes(shift.endTime) > start);
        const boundaries = new Set([start, end]);
        for (const shift of relevant) {
          boundaries.add(Math.max(start, minutes(shift.startTime)));
          boundaries.add(Math.min(end, minutes(shift.endTime)));
        }
        const points = [...boundaries].sort((left, right) => left - right);
        for (let index = 1; index < points.length; index += 1) {
          const segmentStart = points[index - 1];
          const segmentEnd = points[index];
          const scheduledPeople = new Set(relevant.filter((shift) =>
            minutes(shift.startTime) <= segmentStart && minutes(shift.endTime) >= segmentEnd
          ).map((shift) => shift.employeeId)).size;
          if (scheduledPeople >= window.minimumPeople) continue;
          const previous = issues.at(-1);
          if (previous?.code === 'COVERAGE_GAP' && previous.unitId === unitId && previous.date === date
            && previous.endTime === time(segmentStart) && previous.requiredPeople === window.minimumPeople
            && previous.scheduledPeople === scheduledPeople) {
            previous.endTime = time(segmentEnd);
          } else {
            issues.push({ code: 'COVERAGE_GAP', category: 'coverage', unitId, date,
              startTime: time(segmentStart), endTime: time(segmentEnd),
              requiredPeople: window.minimumPeople, scheduledPeople });
          }
        }
      }
    }
  }
  for (const shift of snapshot.shifts) {
    if (shift.date.startsWith(`${plan.period}-`) && !expected.has(shift.unitId)) {
      issues.push({ code: 'SHIFT_OUTSIDE_SCOPE', category: 'data', unitId: shift.unitId, date: shift.date });
    }
  }
  const hasData = issues.some((issue) => issue.category === 'data');
  return {
    period: plan.period,
    status: hasData ? 'incomplete' : issues.length > 0 ? 'gaps' : 'checked',
    scope: 'confirmed_daily_windows_only',
    issues,
    checkedWindows,
  };
}
