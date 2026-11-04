import type { DPShift } from '@/types';

type RestPreviewShift = Pick<DPShift, 'userId' | 'date' | 'type'>;

export function buildScheduleRestPreview(params: {
  shifts: RestPreviewShift[];
  siblingWorkShifts: RestPreviewShift[];
  periodStart: string;
  periodEnd: string;
}) {
  const inMonth = (shift: RestPreviewShift) => shift.date >= params.periodStart && shift.date <= params.periodEnd;
  const userIds = new Set(params.shifts.filter(inMonth).map((shift) => shift.userId));
  const workedDates = new Set([...params.shifts, ...params.siblingWorkShifts]
    .filter((shift) => inMonth(shift) && shift.type === 'work')
    .map((shift) => `${shift.userId}:${shift.date}`));
  const restDates = new Map<string, Set<string>>();
  for (const shift of params.shifts) {
    if (!inMonth(shift) || shift.type !== 'day_off' || workedDates.has(`${shift.userId}:${shift.date}`)) continue;
    const dates = restDates.get(shift.userId) ?? new Set<string>();
    dates.add(shift.date);
    restDates.set(shift.userId, dates);
  }
  return {
    userIds,
    datesByUser: new Map([...restDates].map(([userId, dates]) => [userId, [...dates].sort()])),
  };
}
