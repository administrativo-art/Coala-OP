"use client";

import { useState, useEffect } from 'react';
import type { DPShift } from '@/types';
import { fetchScheduleShifts, subscribeToDPScheduleShiftChanges } from '@/features/dp/schedules/client';

/**
 * Loads shifts from multiple sibling schedules (same month/year, different unit)
 * and returns them merged. Used to show ghost badges in the per-unit schedule editor.
 */
export function useDPSiblingShifts(scheduleIds: string[]): {
  shifts: DPShift[];
  loading: boolean;
} {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(false);

  // Use a stable string key to avoid re-subscribing on every render
  const idsKey = scheduleIds.slice().sort().join(',');

  useEffect(() => {
    const activeIds = idsKey ? idsKey.split(',') : [];
    if (activeIds.length === 0) {
      void Promise.resolve().then(() => {
        setShifts([]);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    const load = () => {
      void Promise.resolve()
        .then(() => {
          if (!cancelled) setLoading(true);
          return Promise.all(activeIds.map(fetchScheduleShifts));
        })
        .then((results) => { if (!cancelled) setShifts(results.flat()); })
        .catch(() => { if (!cancelled) setShifts([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const unsubscribe = subscribeToDPScheduleShiftChanges(activeIds, load);
    return () => { cancelled = true; unsubscribe(); };
  }, [idsKey]);

  return { shifts, loading };
}
