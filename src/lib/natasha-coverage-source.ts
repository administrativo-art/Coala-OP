import { z } from 'zod';

import { natashaCoveragePlanSchema, type NatashaCoveragePlan } from './natasha-roster-coverage';

const id = z.string().trim().min(1).max(180);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const window = z.object({
  startTime: time,
  endTime: time,
  minimumPeople: z.number().int().min(1).max(50),
}).strict().refine((item) => item.endTime > item.startTime);
const sourceWindow = z.object({
  startTime: time,
  endTime: time,
  minimumPeople: z.number().int().min(1).max(50),
  reason: z.string().optional(),
}).passthrough().refine((item) => item.endTime > item.startTime);
const operatingDay = z.union([
  z.object({ isOpen: z.literal(false) }).passthrough(),
  z.object({ isOpen: z.literal(true), startTime: time, endTime: time }).passthrough()
    .refine((item) => item.endTime > item.startTime),
]);
const day = z.discriminatedUnion('status', [
  z.object({ status: z.literal('closed'), windows: z.tuple([]) }).strict(),
  z.object({ status: z.literal('open'), windows: z.array(window).min(1).max(12) }).strict(),
]);

function overlaps(windows: readonly { startTime: string; endTime: string }[]): boolean {
  const sorted = [...windows].sort((left, right) => left.startTime.localeCompare(right.startTime));
  return sorted.some((item, index) => index > 0 && item.startTime < sorted[index - 1].endTime);
}

/** Exportações locais das fontes do Coala mais decisões explícitas do responsável. Sem leitura de rede. */
export const natashaCoverageSourceSchema = z.object({
  period,
  expectedUnitIds: z.array(id).min(1).max(5),
  units: z.array(z.object({
    id,
    isArchived: z.boolean().optional(),
    coverageMode: z.enum(['fixed_hours', 'on_demand', 'disabled']),
    operatingHours: z.record(z.string(), operatingDay).optional(),
  }).passthrough()).max(5),
  schedules: z.array(z.object({
    id,
    unitId: id,
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    coverageDemands: z.record(z.string(), z.array(sourceWindow).max(12)).optional(),
  }).passthrough()).max(5),
  fixedHoursMinimumPeople: z.record(z.string(), z.number().int().min(1).max(50)),
  overrides: z.array(z.object({ unitId: id, date, day, reason: z.string().trim().min(1).max(300) }).strict()).max(155),
  confirmed: z.object({
    allUnits: z.boolean(),
    dailyOpeningsAndExceptions: z.boolean(),
    staffingMinimums: z.boolean(),
  }).strict(),
}).strict().superRefine((source, context) => {
  const expected = new Set(source.expectedUnitIds);
  if (expected.size !== source.expectedUnitIds.length) {
    context.addIssue({ code: 'custom', path: ['expectedUnitIds'], message: 'Unidade esperada repetida.' });
  }
  for (const [name, values] of [
    ['units', source.units.map((unit) => unit.id)],
    ['schedules', source.schedules.map((schedule) => schedule.unitId)],
    ['overrides', source.overrides.map((override) => `${override.unitId}:${override.date}`)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', path: [name], message: 'Documento ou decisão repetida.' });
    }
  }
  if (source.units.some((unit) => !expected.has(unit.id))
    || source.schedules.some((schedule) => !expected.has(schedule.unitId))
    || source.overrides.some((override) => !expected.has(override.unitId))
    || Object.keys(source.fixedHoursMinimumPeople).some((unitId) => !expected.has(unitId))) {
    context.addIssue({ code: 'custom', message: 'Fonte ou decisão fora das unidades declaradas.' });
  }
  for (const [index, schedule] of source.schedules.entries()) {
    if (`${schedule.year}-${String(schedule.month).padStart(2, '0')}` !== source.period) {
      context.addIssue({ code: 'custom', path: ['schedules', index], message: 'Escala de outra competência.' });
    }
    for (const [demandDate, windows] of Object.entries(schedule.coverageDemands ?? {})) {
      if (!date.safeParse(demandDate).success || !demandDate.startsWith(`${source.period}-`)) {
        context.addIssue({ code: 'custom', path: ['schedules', index, 'coverageDemands', demandDate], message: 'Demanda fora da competência.' });
      }
      if (overlaps(windows)) {
        context.addIssue({ code: 'custom', path: ['schedules', index, 'coverageDemands', demandDate], message: 'Janelas de demanda sobrepostas.' });
      }
    }
  }
  for (const [index, override] of source.overrides.entries()) {
    if (!override.date.startsWith(`${source.period}-`)) {
      context.addIssue({ code: 'custom', path: ['overrides', index], message: 'Exceção fora da competência.' });
    }
    if (override.day.status === 'open' && overlaps(override.day.windows)) {
      context.addIssue({ code: 'custom', path: ['overrides', index, 'day'], message: 'Janelas de exceção sobrepostas.' });
    }
  }
});

export type NatashaCoverageSource = z.infer<typeof natashaCoverageSourceSchema>;
export type NatashaCoverageSourceIssue = {
  code: 'UNIT_MISSING' | 'UNIT_ARCHIVED' | 'OPERATING_DAY_UNKNOWN' | 'MINIMUM_UNKNOWN'
    | 'ON_DEMAND_DAY_UNKNOWN' | 'DISABLED_DAY_UNKNOWN' | 'CONFIRM_ALL_UNITS'
    | 'CONFIRM_DAILY_OPENINGS' | 'CONFIRM_STAFFING';
  unitId?: string;
  date?: string;
};
export type NatashaCoverageSourceReport = {
  period: string;
  status: 'ready_for_preflight' | 'questions_pending';
  scope: 'local_sources_only';
  sourceScheduleIds: string[];
  resolvedDays: number;
  expectedDays: number;
  issues: NatashaCoverageSourceIssue[];
  plan: NatashaCoveragePlan | null;
};

function datesInMonth(value: string): string[] {
  const [year, month] = value.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, index) =>
    `${value}-${String(index + 1).padStart(2, '0')}`);
}

function checkedWindows(windows: z.infer<typeof sourceWindow>[]): z.infer<typeof window>[] {
  const compact = windows.map(({ startTime, endTime, minimumPeople }) => ({ startTime, endTime, minimumPeople }));
  return compact;
}

/** Não converte silêncio de cadastro em dia fechado nem confirma demanda por inferência. */
export function prepareNatashaCoverageFromCoala(raw: NatashaCoverageSource): NatashaCoverageSourceReport {
  const source = natashaCoverageSourceSchema.parse(raw);
  const dates = datesInMonth(source.period);
  const units = new Map(source.units.map((unit) => [unit.id, unit]));
  const schedules = new Map(source.schedules.map((schedule) => [schedule.unitId, schedule]));
  const overrides = new Map(source.overrides.map((override) => [`${override.unitId}:${override.date}`, override]));
  const issues: NatashaCoverageSourceIssue[] = [];
  const planUnits: NatashaCoveragePlan['units'] = [];
  let resolvedDays = 0;

  for (const unitId of source.expectedUnitIds) {
    const unit = units.get(unitId);
    if (!unit) {
      issues.push({ code: 'UNIT_MISSING', unitId });
      continue;
    }
    if (unit.isArchived) {
      issues.push({ code: 'UNIT_ARCHIVED', unitId });
      continue;
    }
    const days: NatashaCoveragePlan['units'][number]['days'] = [];
    for (const currentDate of dates) {
      const override = overrides.get(`${unitId}:${currentDate}`);
      if (override) {
        days.push({ date: currentDate, ...override.day });
        resolvedDays += 1;
        continue;
      }
      if (unit.coverageMode === 'fixed_hours') {
        const weekday = String(new Date(`${currentDate}T00:00:00.000Z`).getUTCDay());
        const operating = unit.operatingHours?.[weekday];
        if (!operating) {
          issues.push({ code: 'OPERATING_DAY_UNKNOWN', unitId, date: currentDate });
        } else if (!operating.isOpen) {
          days.push({ date: currentDate, status: 'closed', windows: [] });
          resolvedDays += 1;
        } else {
          const minimumPeople = source.fixedHoursMinimumPeople[unitId];
          if (!minimumPeople) issues.push({ code: 'MINIMUM_UNKNOWN', unitId, date: currentDate });
          else {
            days.push({ date: currentDate, status: 'open', windows: [{
              startTime: operating.startTime, endTime: operating.endTime, minimumPeople,
            }] });
            resolvedDays += 1;
          }
        }
      } else if (unit.coverageMode === 'on_demand') {
        const windows = schedules.get(unitId)?.coverageDemands?.[currentDate];
        if (!windows?.length) issues.push({ code: 'ON_DEMAND_DAY_UNKNOWN', unitId, date: currentDate });
        else {
          days.push({ date: currentDate, status: 'open', windows: checkedWindows(windows) });
          resolvedDays += 1;
        }
      } else {
        issues.push({ code: 'DISABLED_DAY_UNKNOWN', unitId, date: currentDate });
      }
    }
    planUnits.push({ unitId, days });
  }
  if (!source.confirmed.allUnits) issues.push({ code: 'CONFIRM_ALL_UNITS' });
  if (!source.confirmed.dailyOpeningsAndExceptions) issues.push({ code: 'CONFIRM_DAILY_OPENINGS' });
  if (!source.confirmed.staffingMinimums) issues.push({ code: 'CONFIRM_STAFFING' });
  const complete = resolvedDays === dates.length * source.expectedUnitIds.length;
  const plan = complete ? natashaCoveragePlanSchema.parse({
    period: source.period, expectedUnitIds: source.expectedUnitIds,
    scopeConfirmed: issues.length === 0, units: planUnits,
  }) : null;
  return {
    period: source.period,
    status: issues.length === 0 ? 'ready_for_preflight' : 'questions_pending',
    scope: 'local_sources_only',
    sourceScheduleIds: source.schedules.map((item) => item.id).sort(),
    resolvedDays, expectedDays: dates.length * source.expectedUnitIds.length,
    issues, plan,
  };
}
