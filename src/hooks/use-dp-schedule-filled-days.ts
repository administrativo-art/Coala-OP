"use client";

import { useEffect, useMemo, useState } from 'react';

import type { DPSchedule, DPShift } from '@/types';
import { countFilledDPShiftDays } from '@/lib/dp-schedule-progress';
import { fetchScheduleShifts, subscribeToDPScheduleShiftChanges } from '@/features/dp/schedules/client';

/** Counts unique calendar dates containing at least one work shift per schedule. */
export function useDPScheduleFilledDays(schedules: DPSchedule[]) {
  const scheduleIds = useMemo(
    () => Array.from(new Set(schedules.map((schedule) => schedule.id))).sort(),
    [schedules],
  );
  const scheduleKey = scheduleIds.join('|');
  const [filledDaysByScheduleId, setFilledDaysByScheduleId] = useState<Record<string, number>>({});

  useEffect(() => {
    const activeIds = scheduleKey ? scheduleKey.split('|') : [];
    if (activeIds.length === 0) {
      void Promise.resolve().then(() => setFilledDaysByScheduleId({}));
      return;
    }

    let cancelled = false;
    const load = () => {
      void Promise.all(activeIds.map(async (scheduleId) => [
        scheduleId,
        countFilledDPShiftDays(await fetchScheduleShifts(scheduleId) as Array<Pick<DPShift, 'type' | 'date'>>),
      ] as const)).then((entries) => {
        if (!cancelled) setFilledDaysByScheduleId(Object.fromEntries(entries));
      }).catch(() => {
        if (!cancelled) setFilledDaysByScheduleId({});
      });
    };
    load();
    const unsubscribe = subscribeToDPScheduleShiftChanges(activeIds, load);
    return () => { cancelled = true; unsubscribe(); };
  }, [scheduleKey]);

  return filledDaysByScheduleId;
}
