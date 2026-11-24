import type { DPShift } from '@/types';

import { buildWorkDayOffConflictKeys, isDayOffShift } from '@/lib/dp-shift-rules';

export function findBizneoExportDayOffConflicts(shifts: readonly DPShift[]): DPShift[] {
  const conflictKeys = buildWorkDayOffConflictKeys(shifts);
  return shifts.filter((shift) =>
    isDayOffShift(shift) && conflictKeys.has(`${shift.userId}::${shift.date}`),
  );
}
