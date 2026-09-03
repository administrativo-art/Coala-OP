"use client";

import { useState, useEffect, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  collection, onSnapshot,
  doc, query, orderBy, serverTimestamp, writeBatch, increment, getDocs,
} from 'firebase/firestore';
import type { DPShift } from '@/types';
import { rebalanceGoalsForSchedule } from '@/lib/goals-schedule-rebalance';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';

function workShiftPayload(data: Omit<DPShift, 'id' | 'createdAt'> | DPShift) {
  return {
    userId: data.userId,
    ...(data.userName ? { userName: data.userName } : {}),
    unitId: data.unitId,
    date: data.date,
    ...(data.shiftDefinitionId ? { shiftDefinitionId: data.shiftDefinitionId } : {}),
    startTime: data.startTime,
    endTime: data.endTime,
    type: 'work' as const,
  };
}

async function saveWorkShiftRequest(scheduleId: string, shiftId: string, method: 'PUT' | 'PATCH', data: Omit<DPShift, 'id' | 'createdAt'> | DPShift) {
  return authenticatedApiRequest(`/api/dp/schedules/${encodeURIComponent(scheduleId)}/shifts/${encodeURIComponent(shiftId)}`, {
    method,
    json: workShiftPayload(data),
    getIdToken: async () => auth.currentUser?.getIdToken() ?? null,
  });
}

export interface DPShiftsHookResult {
  shifts: DPShift[];
  loading: boolean;
  error: string | null;
  addShift: (data: Omit<DPShift, 'id' | 'createdAt'>) => Promise<void>;
  addShiftsBatch: (data: Omit<DPShift, 'id' | 'createdAt'>[]) => Promise<void>;
  updateShift: (shift: DPShift) => Promise<void>;
  updateShiftsBatch: (shifts: DPShift[]) => Promise<void>;
  deleteShift: (shift: Pick<DPShift, 'id' | 'type'> | string) => Promise<void>;
  deleteShiftsBatch: (shifts: Pick<DPShift, 'id' | 'type'>[]) => Promise<void>;
  clearAllShifts: () => Promise<void>;
}

export function useDPShifts(scheduleId: string | null): DPShiftsHookResult {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const countWorkItems = useCallback(
    (items: Array<Pick<DPShift, 'type'>>) => items.filter((item) => item.type !== 'day_off').length,
    []
  );

  useEffect(() => {
    if (!scheduleId) { setShifts([]); setLoading(false); setError(null); return; }

    setLoading(true);
    setError(null);

    const shiftsQuery = query(
      collection(db, 'dp_schedules', scheduleId, 'shifts'),
      orderBy('date'),
    );

    let resolved = false;
    const fallbackTimeoutId = window.setTimeout(async () => {
      if (resolved) return;
      try {
        const snap = await getDocs(shiftsQuery);
        resolved = true;
        setShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPShift)));
        setLoading(false);
      } catch (fallbackError) {
        console.error('[useDPShifts] Fallback fetch failed.', fallbackError);
        setError('Falha ao carregar os turnos da escala.');
        setLoading(false);
      }
    }, 4000);

    const unsubscribe = onSnapshot(
      shiftsQuery,
      (snap) => {
        resolved = true;
        window.clearTimeout(fallbackTimeoutId);
        setShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPShift)));
        setError(null);
        setLoading(false);
      },
      (snapshotError) => {
        window.clearTimeout(fallbackTimeoutId);
        console.error('[useDPShifts] Subscription failed.', snapshotError);
        setError('Falha ao carregar os turnos da escala.');
        setLoading(false);
      }
    );

    return () => {
      window.clearTimeout(fallbackTimeoutId);
      unsubscribe();
    };
  }, [scheduleId]);

  const addShift = useCallback(async (data: Omit<DPShift, 'id' | 'createdAt'>) => {
    if (!scheduleId) return;
    const shiftRef = doc(collection(db, 'dp_schedules', scheduleId, 'shifts'));
    await saveWorkShiftRequest(scheduleId, shiftRef.id, 'PUT', data);
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  const addShiftsBatch = useCallback(async (data: Omit<DPShift, 'id' | 'createdAt'>[]) => {
    if (!scheduleId || data.length === 0) return;
    // Firestore permite no máximo 500 operações por batch
    const chunks = [];
    for (let i = 0; i < data.length; i += 499) chunks.push(data.slice(i, i + 499));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(item => {
        const ref = doc(collection(db, 'dp_schedules', scheduleId, 'shifts'));
        batch.set(ref, { ...item, createdAt: serverTimestamp() });
      });
      const workCount = countWorkItems(chunk);
      if (workCount > 0) {
        batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: increment(workCount) });
      }
      await batch.commit();
    }
    await rebalanceGoalsForSchedule(scheduleId);
  }, [countWorkItems, scheduleId]);

  const updateShift = useCallback(async ({ id, ...data }: DPShift) => {
    if (!scheduleId) return;
    await saveWorkShiftRequest(scheduleId, id, 'PATCH', data as DPShift);
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  const updateShiftsBatch = useCallback(async (items: DPShift[]) => {
    if (!scheduleId || items.length === 0) return;
    const chunks = [];
    for (let i = 0; i < items.length; i += 500) chunks.push(items.slice(i, i + 500));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(({ id, ...data }) => {
        batch.update(doc(db, 'dp_schedules', scheduleId, 'shifts', id), data as any);
      });
      await batch.commit();
    }
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  const deleteShift = useCallback(async (shift: Pick<DPShift, 'id' | 'type'> | string) => {
    if (!scheduleId) return;
    const batch = writeBatch(db);
    const shiftId = typeof shift === 'string' ? shift : shift.id;
    batch.delete(doc(db, 'dp_schedules', scheduleId, 'shifts', shiftId));
    if (typeof shift !== 'string' && shift.type !== 'day_off') {
      batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: increment(-1) });
    }
    await batch.commit();
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  const deleteShiftsBatch = useCallback(async (items: Pick<DPShift, 'id' | 'type'>[]) => {
    if (!scheduleId || items.length === 0) return;
    const chunks = [];
    for (let i = 0; i < items.length; i += 499) chunks.push(items.slice(i, i + 499));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach((shift) => batch.delete(doc(db, 'dp_schedules', scheduleId, 'shifts', shift.id)));
      const workCount = countWorkItems(chunk as DPShift[]);
      if (workCount > 0) {
        batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: increment(-workCount) });
      }
      await batch.commit();
    }
    await rebalanceGoalsForSchedule(scheduleId);
  }, [countWorkItems, scheduleId]);

  const clearAllShifts = useCallback(async () => {
    if (!scheduleId || shifts.length === 0) return;
    const chunks = [];
    for (let i = 0; i < shifts.length; i += 499) chunks.push(shifts.slice(i, i + 499));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(s => batch.delete(doc(db, 'dp_schedules', scheduleId, 'shifts', s.id)));
      if (chunk === chunks[chunks.length - 1]) {
        batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: 0 });
      }
      await batch.commit();
    }
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId, shifts]);

  return {
    shifts,
    loading,
    error,
    addShift,
    addShiftsBatch,
    updateShift,
    updateShiftsBatch,
    deleteShift,
    deleteShiftsBatch,
    clearAllShifts,
  };
}
