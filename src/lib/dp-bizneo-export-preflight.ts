import type { DPShift } from '@/types';

import { buildWorkDayOffConflictKeys, isDayOffShift } from '@/lib/dp-shift-rules';

export function findBizneoExportDayOffConflicts(shifts: readonly DPShift[]): DPShift[] {
  const conflictKeys = buildWorkDayOffConflictKeys(shifts);
  return shifts.filter((shift) =>
    isDayOffShift(shift) && conflictKeys.has(`${shift.userId}::${shift.date}`),
  );
}

export function classifyBizneoExportWorkShift(
  shift: Pick<DPShift, 'shiftDefinitionId' | 'manualDay' | 'manualDayId'>,
  bizneoShiftId: string,
): 'export' | 'omit-manual' | 'missing-id' {
  if (bizneoShiftId) return 'export';
  if (!shift.shiftDefinitionId && (shift.manualDay || shift.manualDayId)) return 'omit-manual';
  return 'missing-id';
}
