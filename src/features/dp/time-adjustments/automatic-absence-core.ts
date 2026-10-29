import { zonedFiscalTimestamp } from './core';

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The deadline is exactly 24 hours after the scheduled end, in the unit's civil time. */
export function automaticAbsenceDeadline(date: string, startTime: string, endTime: string, overnight: boolean, timeZone: string) {
  const endDate = overnight || endTime <= startTime ? addDays(date, 1) : date;
  const shiftEndAt = zonedFiscalTimestamp(endDate, endTime, timeZone);
  return { shiftEndAt, dueAt: new Date(Date.parse(shiftEndAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) + 86_400_000).toISOString() };
}

export function automaticAbsenceSuperseded(date: string,
  approvedAdjustmentDates: ReadonlySet<string>, approvedAbsencePeriods: ReadonlyArray<{ startDate: string; endDate: string }>) {
  return approvedAdjustmentDates.has(date) || approvedAbsencePeriods.some((item) => item.startDate <= date && item.endDate >= date);
}
