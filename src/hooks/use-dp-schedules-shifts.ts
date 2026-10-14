"use client";

import { useEffect, useMemo, useState } from "react";

import type { DPShift } from "@/types";
import { fetchScheduleShifts, subscribeToDPScheduleShiftChanges } from "@/features/dp/schedules/client";

export function useDPSchedulesShifts(scheduleIds: string[]) {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedScheduleIds, setFailedScheduleIds] = useState<string[]>([]);
  const scheduleIdsKey = useMemo(
    () => JSON.stringify(Array.from(new Set(scheduleIds.filter(Boolean))).sort()),
    [scheduleIds]
  );
  const stableScheduleIds = useMemo(() => JSON.parse(scheduleIdsKey) as string[], [scheduleIdsKey]);

  useEffect(() => {
    if (stableScheduleIds.length === 0) {
      void Promise.resolve().then(() => {
        setShifts([]);
        setLoading(false);
        setError(null);
        setFailedScheduleIds([]);
      });
      return;
    }

    let cancelled = false;
    const isMultiSchedule = stableScheduleIds.length > 1;

    const load = () => {
      void Promise.resolve()
        .then(() => {
          if (!cancelled) {
            setLoading(true);
            setError(null);
          }
          return Promise.allSettled(stableScheduleIds.map(async (scheduleId) => ({
            scheduleId,
            shifts: (await fetchScheduleShifts(scheduleId)).map((shift) => ({
              ...shift,
              id: isMultiSchedule ? `${scheduleId}:${shift.id}` : shift.id,
              scheduleId,
            })),
          })));
        })
        .then((results) => {
          if (cancelled) return;
          const groups = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
          const failedIds = results.flatMap((result, index) => (
            result.status === 'rejected' ? [stableScheduleIds[index]] : []
          ));
          setShifts(groups.flatMap((group) => group.shifts).sort(
            (a, b) => a.date.localeCompare(b.date)
              || (a.startTime || "").localeCompare(b.startTime || ""),
          ));
          setFailedScheduleIds(failedIds);
          setError(failedIds.length > 0 ? 'Falha ao carregar os turnos de algumas escalas.' : null);
          setLoading(false);
        })
        .catch((loadError) => {
          console.error("[useDPSchedulesShifts] Secure fetch failed.", loadError);
          if (!cancelled) {
            setError("Falha ao carregar os turnos das escalas.");
            setFailedScheduleIds(stableScheduleIds);
            setLoading(false);
          }
        });
    };
    load();
    const unsubscribe = subscribeToDPScheduleShiftChanges(stableScheduleIds, load);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [stableScheduleIds]);

  return { shifts, loading, error, failedScheduleIds };
}
