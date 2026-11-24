"use client";

import { useState, useEffect } from 'react';
import type { DPShift } from '@/types';
import { fetchDraftScheduleShifts, fetchScheduleShifts, subscribeToDPScheduleShiftChanges } from '@/features/dp/schedules/client';

/**
 * Loads shifts from multiple sibling schedules (same month/year, different unit)
 * and returns them merged. Used to show ghost badges in the per-unit schedule editor.
 */
export function useDPSiblingShifts(scheduleIds: string[], editable = false): {
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
    let request = 0;
    const load = () => {
      const current = ++request;
      const isCurrent = () => !cancelled && current === request;
      void Promise.resolve()
        .then(() => {
          if (isCurrent()) setLoading(true);
          return Promise.allSettled(activeIds.map(async (id) => {
            if (!editable) return fetchScheduleShifts(id);
            try {
              return (await fetchDraftScheduleShifts(id)).shifts;
            } catch {
              return fetchScheduleShifts(id);
            }
          }));
        })
        .then((results) => {
          if (isCurrent()) setShifts(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
        })
        .finally(() => { if (isCurrent()) setLoading(false); });
    };
    load();
    const unsubscribe = subscribeToDPScheduleShiftChanges(activeIds, load);
    return () => { cancelled = true; unsubscribe(); };
  }, [editable, idsKey]);

  return { shifts, loading };
}
