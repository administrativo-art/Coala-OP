import { addDays, differenceInCalendarDays, format, parse } from 'date-fns';

import type { DPShift } from '@/types';

export function isDayOffShift(shift: DPShift) {
  return shift.type === 'day_off';
}

export function isWorkShift(shift: DPShift) {
  return shift.type !== 'day_off';
}

function shiftOccupationKey(shift: Pick<DPShift, 'userId' | 'date'>) {
  return `${shift.userId}::${shift.date}`;
}

/**
 * Conflitos entre unidades são estado derivado das escalas-irmãs atuais.
 * O campo persistido em um turno pode ter sido calculado antes de outra
 * alocação ser removida; por isso ele não participa desta decisão.
 */
export function buildCrossUnitConflictShiftIds(
  currentShifts: readonly DPShift[],
  siblingShifts: readonly DPShift[],
) {
  const siblingOccupations = new Set(
    siblingShifts
      .filter(isWorkShift)
      .map(shiftOccupationKey),
  );

  return new Set(
    currentShifts
      .filter(isWorkShift)
      .filter((shift) => siblingOccupations.has(shiftOccupationKey(shift)))
      .map((shift) => shift.id),
  );
}

/**
 * Um registro de folga e um turno de trabalho para a mesma pessoa/data são
 * estados mutuamente exclusivos. A derivação mantém inconsistências antigas
 * visíveis até que a operação seja reconciliada.
 */
export function buildWorkDayOffConflictShiftIds(shifts: readonly DPShift[]) {
  const conflictKeys = buildWorkDayOffConflictKeys(shifts);

  return new Set(
    shifts
      .filter(isWorkShift)
      .filter((shift) => conflictKeys.has(shiftOccupationKey(shift)))
      .map((shift) => shift.id),
  );
}

export function buildWorkDayOffConflictKeys(shifts: readonly DPShift[]) {
  const workOccupations = new Set(
    shifts
      .filter(isWorkShift)
      .map(shiftOccupationKey),
  );
  const dayOffOccupations = new Set(
    shifts
      .filter(isDayOffShift)
      .map(shiftOccupationKey),
  );

  return new Set(
    [...dayOffOccupations].filter((key) => workOccupations.has(key)),
  );
}

export function compareWorkShiftsByTime(left: DPShift, right: DPShift) {
  const byStart = left.startTime.localeCompare(right.startTime);
  if (byStart !== 0) return byStart;
  const byEnd = left.endTime.localeCompare(right.endTime);
  if (byEnd !== 0) return byEnd;
  const byName = (left.userName ?? '').localeCompare(right.userName ?? '', 'pt-BR');
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
}

export function nextISODate(date: string) {
  return format(addDays(parse(date, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd');
}

export function isPredictedDayOffDate(workedDates: ReadonlySet<string>, targetDate: string) {
  if (workedDates.has(targetDate)) return false;

  let cursor = parse(targetDate, 'yyyy-MM-dd', new Date());
  let consecutiveDays = 0;
  // A interface trabalha com a competência atual e a anterior. O limite impede
  // que um dado inconsistente transforme esta validação em uma busca sem fim.
  for (let index = 0; index < 62; index += 1) {
    cursor = addDays(cursor, -1);
    const date = format(cursor, 'yyyy-MM-dd');
    if (!workedDates.has(date)) break;
    consecutiveDays += 1;
  }

  return consecutiveDays > 0 && consecutiveDays % 6 === 0;
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

      const nextDate = nextISODate(date);
      if (isPredictedDayOffDate(workedDates, nextDate)) {
        if (!predictedDayOffsByUser.has(userId)) predictedDayOffsByUser.set(userId, []);
        predictedDayOffsByUser.get(userId)!.push({
          date: nextDate,
          sourceUnitId: shiftsOnDate[0]?.unitId ?? '',
        });
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
