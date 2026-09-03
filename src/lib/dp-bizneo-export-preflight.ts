import type { DPShift } from '@/types';

import { buildWorkDayOffConflictKeys, isDayOffShift, isWorkShift } from '@/lib/dp-shift-rules';

export type DPBizneoExportBlocker = {
  kind: 'work_day_off_conflict' | 'day_off_sync_unresolved';
  userId: string;
  date: string;
  shiftId: string;
  syncStatus?: DPShift['bizneoSyncStatus'];
};

export function buildBizneoExportDayOffBlockers(shifts: readonly DPShift[]): DPBizneoExportBlocker[] {
  const conflictKeys = buildWorkDayOffConflictKeys(shifts);
  const workKeys = new Set(
    shifts
      .filter(isWorkShift)
      .map((shift) => `${shift.userId}::${shift.date}`),
  );

  const blockers: DPBizneoExportBlocker[] = [];
  shifts.filter(isDayOffShift).forEach((shift) => {
    const key = `${shift.userId}::${shift.date}`;
    if (conflictKeys.has(key) || workKeys.has(key)) {
      blockers.push({
        kind: 'work_day_off_conflict',
        userId: shift.userId,
        date: shift.date,
        shiftId: shift.id,
        syncStatus: shift.bizneoSyncStatus,
      });
      return;
    }
    if (shift.bizneoSyncStatus !== 'published') {
      blockers.push({
        kind: 'day_off_sync_unresolved',
        userId: shift.userId,
        date: shift.date,
        shiftId: shift.id,
        syncStatus: shift.bizneoSyncStatus,
      });
    }
  });
  return blockers;
}
