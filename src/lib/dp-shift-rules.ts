import { addDays, differenceInCalendarDays, format, parse } from 'date-fns';

import type { DPShift } from '@/types';

export function isDayOffShift(shift: DPShift) {
  return shift.type === 'day_off';
}

export function isWorkShift(shift: DPShift) {
  return shift.type !== 'day_off';
}

export function nextISODate(date: string) {
  return format(addDays(parse(date, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd');
}

export function buildShiftStreakState(shifts: DPShift[]) {
  const countByShiftId = new Map<string, number>();
  const workedDatesByUser = new Map<string, Set<string>>();
  const predictedDayOffsByUser = new Map<string, Array<{ date: string; sourceUnitId: string }>>();

  const byUserDate = new Map<string, Map<string, DPShift[]>>();

  shifts
    .filter(isWorkShift)
    .forEach((shift) => {
      if (!byUserDate.has(shift.userId)) byUserDate.set(shift.userId, new Map());
      const dateMap = byUserDate.get(shift.userId)!;
      if (!dateMap.has(shift.date)) dateMap.set(shift.date, []);
      dateMap.get(shift.date)!.push(shift);
    });

  byUserDate.forEach((dateMap, userId) => {
    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => a.localeCompare(b));
    const workedDates = new Set(sortedDates);
    workedDatesByUser.set(userId, workedDates);

    let streak = 0;
    let prevDate: string | null = null;

    sortedDates.forEach((date) => {
      if (!prevDate) {
        streak = 1;
      } else {
        const diff = differenceInCalendarDays(
          parse(date, 'yyyy-MM-dd', new Date()),
          parse(prevDate, 'yyyy-MM-dd', new Date()),
        );
        streak = diff === 1 ? streak + 1 : 1;
      }

      const shiftsOnDate = dateMap.get(date) ?? [];
      shiftsOnDate.forEach((shift) => countByShiftId.set(shift.id, streak));

      if (streak % 6 === 0) {
        const nextDate = nextISODate(date);
        if (!workedDates.has(nextDate)) {
          if (!predictedDayOffsByUser.has(userId)) predictedDayOffsByUser.set(userId, []);
          predictedDayOffsByUser.get(userId)!.push({
            date: nextDate,
            sourceUnitId: shiftsOnDate[0]?.unitId ?? '',
          });
        }
      }

      prevDate = date;
    });
  });

  return {
    countByShiftId,
    workedDatesByUser,
    predictedDayOffsByUser,
  };
}
