"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { DPShift } from "@/types";

export function useDPSchedulesShifts(scheduleIds: string[]) {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scheduleIdsKey = useMemo(
    () => JSON.stringify(Array.from(new Set(scheduleIds.filter(Boolean))).sort()),
    [scheduleIds]
  );
  const stableScheduleIds = useMemo(() => JSON.parse(scheduleIdsKey) as string[], [scheduleIdsKey]);

  useEffect(() => {
    if (stableScheduleIds.length === 0) {
      setShifts([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const shiftsBySchedule = new Map<string, DPShift[]>();
    const pendingScheduleIds = new Set(stableScheduleIds);
    const isMultiSchedule = stableScheduleIds.length > 1;

    const publish = () => {
      const merged = stableScheduleIds
        .flatMap((scheduleId) => shiftsBySchedule.get(scheduleId) ?? [])
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));
      setShifts(merged);
    };

    const mapShift = (scheduleId: string, docSnap: { id: string; data: () => Record<string, unknown> }) => ({
      id: isMultiSchedule ? `${scheduleId}:${docSnap.id}` : docSnap.id,
      scheduleId,
      ...docSnap.data(),
    }) as DPShift;

    setLoading(true);
    setError(null);

    const fallbackTimeoutId = window.setTimeout(async () => {
      if (cancelled || pendingScheduleIds.size === 0) return;
      try {
        const snaps = await Promise.all(
          stableScheduleIds.map((scheduleId) =>
            getDocs(query(collection(db, "dp_schedules", scheduleId, "shifts"), orderBy("date")))
          )
        );
        if (cancelled) return;
        snaps.forEach((snap, index) => {
          const scheduleId = stableScheduleIds[index];
          shiftsBySchedule.set(scheduleId, snap.docs.map((docSnap) => mapShift(scheduleId, docSnap)));
        });
        pendingScheduleIds.clear();
        publish();
        setLoading(false);
      } catch (fallbackError) {
        console.error("[useDPSchedulesShifts] Fallback fetch failed.", fallbackError);
        if (!cancelled) {
          setError("Falha ao carregar os turnos das escalas.");
          setLoading(false);
        }
      }
    }, 4000);

    const unsubscribes = stableScheduleIds.map((scheduleId) => {
      const shiftsQuery = query(collection(db, "dp_schedules", scheduleId, "shifts"), orderBy("date"));
      return onSnapshot(
        shiftsQuery,
        (snap) => {
          if (cancelled) return;
          shiftsBySchedule.set(scheduleId, snap.docs.map((docSnap) => mapShift(scheduleId, docSnap)));
          pendingScheduleIds.delete(scheduleId);
          publish();
          if (pendingScheduleIds.size === 0) {
            window.clearTimeout(fallbackTimeoutId);
            setLoading(false);
          }
        },
        (snapshotError) => {
          console.error("[useDPSchedulesShifts] Subscription failed.", snapshotError);
          if (cancelled) return;
          pendingScheduleIds.delete(scheduleId);
          setError("Falha ao carregar os turnos das escalas.");
          if (pendingScheduleIds.size === 0) {
            window.clearTimeout(fallbackTimeoutId);
            setLoading(false);
          }
        }
      );
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimeoutId);
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [stableScheduleIds]);

  return { shifts, loading, error };
}
