"use client";

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { DPSchedule, DPShift } from '@/types';
import { countFilledDPShiftDays } from '@/lib/dp-schedule-progress';

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
      setFilledDaysByScheduleId({});
      return;
    }

    setFilledDaysByScheduleId((current) => Object.fromEntries(
      activeIds.map((id) => [id, current[id] ?? 0]),
    ));

    return activeIds.map((scheduleId) => onSnapshot(
      collection(db, 'dp_schedules', scheduleId, 'shifts'),
      (snapshot) => {
        const filledDays = countFilledDPShiftDays(snapshot.docs.map((document) => (
          document.data() as Pick<DPShift, 'type' | 'date'>
        )));
        setFilledDaysByScheduleId((current) => ({
          ...current,
          [scheduleId]: filledDays,
        }));
      },
      (error) => {
        console.error(`[useDPScheduleFilledDays] Falha ao carregar ${scheduleId}.`, error);
      },
    )).reduce<() => void>((unsubscribeAll, unsubscribe) => () => {
      unsubscribeAll();
      unsubscribe();
    }, () => undefined);
  }, [scheduleKey]);

  return filledDaysByScheduleId;
}
