import { createHash } from 'node:crypto';

import type { DPOvertimePolicy } from '@/types';
import type { DPShiftReference } from '@/lib/dp-shift-reference';
import { shiftDurationSummary } from '@/lib/dp-shift-duration';
import { isCivilDate, type EmploymentResolution } from '../employment-reference/resolve';

export const DAILY_TIME_ALGORITHM_VERSION = 'daily-time-simulation-v1' as const;

export type HistoricalShiftInput = { shiftId: string; referenceRevisionId: string; reference: DPShiftReference };
export type WorkedInterval = {
  id: string;
  /** Dia civil ao qual o normalizador atribuiu o intervalo, inclusive quando ele cruza a meia-noite. */
  workDate: string;
  start: string;
  end: string;
  executionUnitId: string;
};
export type AbsenceAdjustment = { id: string };
export type OvertimePolicyResolution =
  | { status: 'none' | 'ambiguous' }
  | { status: 'resolved'; policy: Pick<DPOvertimePolicy,
    'id' | 'version' | 'status' | 'validFrom' | 'validTo' | 'timeBank' | 'externalCoverageRule'> };

export type DailyTimeInput = {
  userId: string;
  workDate: string;
  employment: EmploymentResolution;
  shifts: HistoricalShiftInput[];
  overtimePolicy: OvertimePolicyResolution;
  workedIntervals: WorkedInterval[];
  absenceAdjustments?: AbsenceAdjustment[];
};

export type DailyTimeIssue =
  | 'INVALID_INPUT' | 'EMPLOYMENT_MISSING' | 'EMPLOYMENT_GAP' | 'EMPLOYMENT_INCONSISTENT'
  | 'EMPLOYMENT_DATE_MISMATCH' | 'EMPLOYMENT_NOT_ELIGIBLE' | 'SHIFT_REFERENCE_MISSING'
  | 'SHIFT_REFERENCE_INCONSISTENT' | 'SHIFT_REFERENCE_DUPLICATE' | 'SHIFT_REFERENCE_OVERLAP'
  | 'JOURNEY_INVALID' | 'JOURNEY_MANUAL_REVIEW' | 'JOURNEY_SCHEDULE_AMBIGUOUS'
  | 'SHIFT_DEFINITION_INCONSISTENT' | 'WORK_INTERVAL_INVALID' | 'WORK_INTERVAL_DUPLICATE'
  | 'WORK_INTERVAL_OVERLAP' | 'WORK_INTERVAL_MISSING' | 'ABSENCE_REQUIRES_REVIEW'
  | 'POLICY_MISSING' | 'POLICY_AMBIGUOUS' | 'POLICY_INVALID' | 'TIME_BANK_DISABLED'
  | 'NEGATIVE_BALANCE_DISABLED' | 'EXTERNAL_COVERAGE_REQUIRES_REVIEW' | 'POSITIVE_DELTA_REQUIRES_REVIEW';

export type DailyTimeResult = {
  status: 'calculated' | 'review_required';
  complianceStatus: 'simulation_only';
  summary: { referenceMinutes: number | null; plannedShiftMinutes: number | null;
    workedMinutes: number | null; deltaMinutes: number | null };
  issues: DailyTimeIssue[];
  provenance: {
    employmentHistoryId: string | null; employmentRevision: number | null; employerUnitId: string | null;
    journeyId: string | null; journeyLineageId: string | null; journeyVersion: number | null;
    policyId: string | null; policyVersion: number | null;
    shiftReferenceRevisionIds: string[]; shiftIds: string[]; workIntervalIds: string[];
    algorithmVersion: typeof DAILY_TIME_ALGORITHM_VERSION;
  };
  sourceKey: string;
  movement: null | { destination: 'time_bank'; kind: 'debit'; minutes: number };
};

const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 180;
const minute = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1440;
const hhmm = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const clockMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const sort = (values: string[]) => [...values].sort();
const unique = (values: string[]) => new Set(values).size === values.length;
const civilDay = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;

function interval(start: string, end: string): [number, number] | null {
  if (!hhmm(start) || !hhmm(end) || start === end) return null;
  const first = clockMinute(start);
  let last = clockMinute(end);
  if (last < first) last += 1440;
  return [first, last];
}

function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return null;
  if (!isCivilDate(value.slice(0, 10)) || !hhmm(value.slice(11, 16))) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp % 60_000 === 0 ? timestamp : null;
}

function stable(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sourceKey(input: DailyTimeInput): string {
  const canonical = {
    algorithmVersion: DAILY_TIME_ALGORITHM_VERSION, userId: input.userId, workDate: input.workDate,
    employment: input.employment, overtimePolicy: input.overtimePolicy,
    shifts: [...input.shifts].sort((a, b) => stable(a).localeCompare(stable(b))),
    workedIntervals: [...input.workedIntervals].sort((a, b) => stable(a).localeCompare(stable(b))),
    absenceAdjustments: [...(input.absenceAdjustments ?? [])].sort((a, b) => stable(a).localeCompare(stable(b))),
  };
  return `daily-time:${createHash('sha256').update(stable(canonical)).digest('hex')}`;
}

/** Pure, deliberately incomplete daily simulation; never a payable balance or legal compliance finding. */
export function calculateDailyTime(input: DailyTimeInput): DailyTimeResult {
  const issues = new Set<DailyTimeIssue>();
  const shifts = Array.isArray(input.shifts) ? input.shifts : [];
  const work = Array.isArray(input.workedIntervals) ? input.workedIntervals : [];
  const absences = Array.isArray(input.absenceAdjustments) ? input.absenceAdjustments : [];
  const employment = input.employment;
  const policy = input.overtimePolicy;
  const first = shifts[0]?.reference;
  const result: DailyTimeResult = {
    status: 'review_required', complianceStatus: 'simulation_only',
    summary: { referenceMinutes: null, plannedShiftMinutes: null, workedMinutes: null, deltaMinutes: null },
    issues: [], movement: null, sourceKey: '',
    provenance: {
      employmentHistoryId: employment?.status === 'matched' ? employment.historyId : null,
      employmentRevision: employment?.status === 'matched' ? employment.revision : null,
      employerUnitId: employment?.status === 'matched' ? employment.period?.employerUnitId ?? null : null,
      journeyId: first?.journey?.id ?? null, journeyLineageId: first?.journey?.lineageId ?? null,
      journeyVersion: first?.journey?.version ?? null,
      policyId: policy?.status === 'resolved' ? policy.policy?.id ?? null : null,
      policyVersion: policy?.status === 'resolved' ? policy.policy?.version ?? null : null,
      shiftReferenceRevisionIds: sort(shifts.flatMap((item) => item && typeof item === 'object' && id(item.referenceRevisionId)
        ? [item.referenceRevisionId] : [])),
      shiftIds: sort(shifts.flatMap((item) => item && typeof item === 'object' && id(item.shiftId) ? [item.shiftId] : [])),
      workIntervalIds: sort(work.flatMap((item) => item && typeof item === 'object' && id(item.id) ? [item.id] : [])),
      algorithmVersion: DAILY_TIME_ALGORITHM_VERSION,
    },
  };
  // Malformed inputs still get a deterministic review result, never a proposed movement.
  try { result.sourceKey = sourceKey(input); } catch { issues.add('INVALID_INPUT'); result.sourceKey = 'daily-time:invalid'; }
  if (!id(input.userId) || !isCivilDate(input.workDate)
    || !Array.isArray(input.shifts) || shifts.length > 20
    || !Array.isArray(input.workedIntervals) || work.length > 20
    || !Array.isArray(input.absenceAdjustments ?? []) || absences.length > 20) issues.add('INVALID_INPUT');

  if (!employment || employment.status === 'missing') issues.add('EMPLOYMENT_MISSING');
  else if (employment.status === 'gap') issues.add('EMPLOYMENT_GAP');
  else if (employment.status === 'inconsistent') issues.add('EMPLOYMENT_INCONSISTENT');
  else {
    if (employment.date !== input.workDate || !id(employment.historyId)
      || !Number.isSafeInteger(employment.revision) || employment.revision < 1
      || !id(employment.period?.employerUnitId)
      || employment.period?.employer?.unitId !== employment.period?.employerUnitId
      || employment.period?.employer?.identityStatus !== 'catalog_identifiers_consistent_unverified'
      || !/^\d{14}$/.test(employment.period?.employer?.cnpj ?? '')
      || !isCivilDate(employment.period?.validFrom)
      || Boolean(employment.period?.validFrom && employment.period.validFrom > input.workDate)
      || Boolean(employment.period?.validTo && !isCivilDate(employment.period.validTo))
      || employment.period?.validTo && employment.period.validTo < input.workDate) issues.add('EMPLOYMENT_DATE_MISMATCH');
    if (!['clt', 'apprenticeship', 'internship'].includes(employment.period?.employmentRelationshipType)) issues.add('EMPLOYMENT_NOT_ELIGIBLE');
  }

  if (!shifts.length) issues.add('SHIFT_REFERENCE_MISSING');
  if (!unique(shifts.flatMap((item) => item && typeof item === 'object' ? [item.referenceRevisionId] : []))
    || !unique(shifts.flatMap((item) => item && typeof item === 'object' ? [item.shiftId] : []))) issues.add('SHIFT_REFERENCE_DUPLICATE');
  const planned: Array<[number, number]> = [];
  let plannedMinutes = 0;
  for (const item of shifts) {
    if (!item || typeof item !== 'object') {
      issues.add('SHIFT_REFERENCE_INCONSISTENT'); continue;
    }
    const ref = item.reference;
    if (!id(item.shiftId) || !id(item.referenceRevisionId) || !ref?.journey) {
      issues.add('SHIFT_REFERENCE_INCONSISTENT'); continue;
    }
    if (ref.schemaVersion !== 1 || ref.collaboratorId !== input.userId || ref.plannedDate !== input.workDate
      || !id(ref.executionUnitId) || !id(ref.journey.id) || !id(ref.journey.lineageId)
      || !Number.isSafeInteger(ref.journey.version) || ref.journey.version < 1
      || ref.journey.id !== first?.journey.id || ref.journey.lineageId !== first?.journey.lineageId
      || ref.journey.version !== first?.journey.version || stable(ref.journey) !== stable(first?.journey)
      || stable(ref.collaborator) !== stable(first?.collaborator)
      || employment?.status === 'matched' && (
        Boolean(ref.collaborator?.employerUnitId && ref.collaborator.employerUnitId !== employment.period?.employerUnitId)
        || Boolean(ref.collaborator?.employerCnpj && ref.collaborator.employerCnpj !== employment.period?.employer?.cnpj)
      )) {
      issues.add('SHIFT_REFERENCE_INCONSISTENT');
    }
    const slot = interval(ref.plannedStartTime, ref.plannedEndTime);
    if (!slot) { issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue; }
    planned.push(slot);
    const definition = ref.shiftDefinition;
    const breakType = definition?.breakType ?? (definition?.breakStart && definition?.breakEnd ? 'fixed' : 'none');
    if (!definition || !id(definition.id) || definition.startTime !== ref.plannedStartTime
      || definition.endTime !== ref.plannedEndTime || !hhmm(definition.startTime) || !hhmm(definition.endTime)
      || Boolean(definition.overnight) !== (slot[1] >= 1440)
      || !['none', 'fixed', 'flexible', 'staggered'].includes(breakType)
      || breakType === 'none' && Boolean(definition.breakStart || definition.breakEnd)) {
      issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue;
    }
    if (breakType === 'fixed' && (!hhmm(definition.breakStart) || !hhmm(definition.breakEnd))) {
      issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue;
    }
    if (breakType === 'fixed' && definition.breakStart && definition.breakEnd) {
      const breakSlot = interval(definition.breakStart, definition.breakEnd);
      if (!breakSlot) { issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue; }
      if (breakSlot[0] < slot[0]) { breakSlot[0] += 1440; breakSlot[1] += 1440; }
      if (breakSlot[0] < slot[0] || breakSlot[1] > slot[1]) {
        issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue;
      }
    }
    if (['flexible', 'staggered'].includes(breakType) && !minute(definition.breakDurationMinutes)) {
      issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue;
    }
    const duration = shiftDurationSummary({
      startTime: definition.startTime, endTime: definition.endTime, overnight: definition.overnight,
      breakType, breakStart: definition.breakStart ?? undefined,
      breakEnd: definition.breakEnd ?? undefined, breakDurationMinutes: definition.breakDurationMinutes ?? undefined,
    });
    if (!minute(duration.workedMinutes) || duration.grossMinutes > 1440 || duration.breakMinutes >= duration.grossMinutes) {
      issues.add('SHIFT_DEFINITION_INCONSISTENT'); continue;
    }
    plannedMinutes += duration.workedMinutes;
  }
  if (planned.every((slot) => slot[1] > slot[0]) && planned.length === shifts.length) {
    planned.sort((a, b) => a[0] - b[0]);
    if (planned.some((slot, index) => index > 0 && slot[0] < planned[index - 1][1])) issues.add('SHIFT_REFERENCE_OVERLAP');
  }
  if (shifts.length && !issues.has('SHIFT_DEFINITION_INCONSISTENT') && minute(plannedMinutes)) result.summary.plannedShiftMinutes = plannedMinutes;
  else if (plannedMinutes > 1440) issues.add('SHIFT_DEFINITION_INCONSISTENT');

  const journey = first?.journey;
  if (journey?.scaleValidation?.mode === 'manual_review') issues.add('JOURNEY_MANUAL_REVIEW');
  if (!journey || !isCivilDate(journey.validFrom) || journey.validFrom > input.workDate
    || journey.validTo && ( !isCivilDate(journey.validTo) || journey.validTo < input.workDate)
    || !Number.isSafeInteger(journey.cycleLengthDays) || journey.cycleLengthDays < 1 || journey.cycleLengthDays > 42
    || !Array.isArray(journey.days) || journey.days.length !== journey.cycleLengthDays
    || journey.days.some((day) => !day || !Number.isSafeInteger(day.dayIndex) || day.dayIndex < 1
      || day.dayIndex > journey.cycleLengthDays || !minute(day.plannedMinutes)
      || day.isRestDay !== (day.plannedMinutes === 0))
    || !unique(journey.days.map((day) => String(day.dayIndex)))
    || !Number.isSafeInteger(journey.weeklyMinutes)
    || journey.days.reduce((total, day) => total + day.plannedMinutes, 0) * 7
      !== journey.weeklyMinutes * journey.cycleLengthDays) issues.add('JOURNEY_INVALID');
  else if (journey.weeklyRest?.placement === 'schedule') {
    const positive = [...new Set(journey.days.map((day) => day.plannedMinutes).filter((value) => value > 0))];
    if (positive.length !== 1 || !shifts.length) issues.add('JOURNEY_SCHEDULE_AMBIGUOUS');
    else result.summary.referenceMinutes = positive[0];
  } else if (!journey.weeklyRest || journey.weeklyRest.placement === 'fixed_cycle') {
    const index = ((civilDay(input.workDate) - civilDay(journey.validFrom)) % journey.cycleLengthDays) + 1;
    const day = journey.days.find((entry) => entry.dayIndex === index);
    if (!day) issues.add('JOURNEY_INVALID');
    else result.summary.referenceMinutes = day.plannedMinutes;
  } else issues.add('JOURNEY_INVALID');

  if (!unique(work.flatMap((item) => item && typeof item === 'object' ? [item.id] : []))) issues.add('WORK_INTERVAL_DUPLICATE');
  const actual: Array<[number, number]> = [];
  for (const item of work) {
    if (!item || typeof item !== 'object') {
      issues.add('WORK_INTERVAL_INVALID'); continue;
    }
    const start = instant(item.start);
    const end = instant(item.end);
    if (!id(item.id) || item.workDate !== input.workDate || !id(item.executionUnitId)
      || start === null || end === null || item.start.slice(0, 10) !== item.workDate
      || end <= start || end - start > 86_400_000) issues.add('WORK_INTERVAL_INVALID');
    else actual.push([start, end]);
  }
  actual.sort((a, b) => a[0] - b[0]);
  if (actual.some((slot, index) => index > 0 && slot[0] < actual[index - 1][1])) issues.add('WORK_INTERVAL_OVERLAP');
  if (!work.length) issues.add('WORK_INTERVAL_MISSING');
  const workedMinutes = actual.reduce((sum, [start, end]) => sum + (end - start) / 60_000, 0);
  if (actual.length === work.length && minute(workedMinutes)) result.summary.workedMinutes = workedMinutes;
  else if (!minute(workedMinutes)) issues.add('WORK_INTERVAL_INVALID');
  if (result.summary.referenceMinutes !== null && result.summary.workedMinutes !== null)
    result.summary.deltaMinutes = result.summary.workedMinutes - result.summary.referenceMinutes;

  if (absences.length || absences.some((item) => !item || typeof item !== 'object' || !id(item.id))
    || !unique(absences.flatMap((item) => item && typeof item === 'object' ? [item.id] : []))) issues.add('ABSENCE_REQUIRES_REVIEW');
  if (!policy || policy.status === 'none') issues.add('POLICY_MISSING');
  else if (policy.status === 'ambiguous') issues.add('POLICY_AMBIGUOUS');
  else if (policy.status === 'resolved') {
    const config = policy.policy;
    if (!id(config?.id) || !Number.isSafeInteger(config.version) || config.version < 1
      || !['published', 'archived'].includes(config.status)
      || config.status === 'archived' && !config.validTo
      || !isCivilDate(config.validFrom)
      || config.validFrom > input.workDate || config.validTo && (!isCivilDate(config.validTo) || config.validTo < input.workDate)
      || !['origin', 'manual_review', 'execution_unit'].includes(config.externalCoverageRule)) issues.add('POLICY_INVALID');
    if (!config?.timeBank?.enabled) issues.add('TIME_BANK_DISABLED');
    if (!config?.timeBank?.allowNegativeBalance) issues.add('NEGATIVE_BALANCE_DISABLED');
    const external = [...shifts.flatMap((item) => item && typeof item === 'object' ? [item.reference?.executionUnitId] : []),
      ...work.flatMap((item) => item && typeof item === 'object' ? [item.executionUnitId] : [])]
      .some((unitId) => unitId !== (employment?.status === 'matched' ? employment.period?.unitId : null));
    if (external && config?.externalCoverageRule !== 'origin') issues.add('EXTERNAL_COVERAGE_REQUIRES_REVIEW');
  }
  if (result.summary.deltaMinutes !== null && result.summary.deltaMinutes > 0) issues.add('POSITIVE_DELTA_REQUIRES_REVIEW');
  result.issues = [...issues].sort();
  if (!result.issues.length) {
    result.status = 'calculated';
    if (result.summary.deltaMinutes! < 0) result.movement = {
      destination: 'time_bank', kind: 'debit', minutes: result.summary.deltaMinutes!,
    };
  }
  return result;
}
