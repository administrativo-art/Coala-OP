"use client";

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import type { DPShift } from '@/types';

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
    if (scheduleIds.length === 0) {
      setShifts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const results = new Map<string, DPShift[]>();
    let resolvedCount = 0;
    const unsubs: (() => void)[] = [];

    for (const id of scheduleIds) {
      const q = query(
        collection(db, 'dp_schedules', id, 'shifts'),
        orderBy('date'),
      );
      const unsub = onSnapshot(q, snap => {
        results.set(id, snap.docs.map(d => ({ id: d.id, ...d.data() } as DPShift)));
        resolvedCount++;
        if (resolvedCount >= scheduleIds.length) setLoading(false);
        setShifts(Array.from(results.values()).flat());
      }, () => {
        resolvedCount++;
        if (resolvedCount >= scheduleIds.length) setLoading(false);
      });
      unsubs.push(unsub);
    }

    return () => unsubs.forEach(u => u());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return { shifts, loading };
}
