"use client";

import { useState, useEffect, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  collection, onSnapshot,
  doc, query, orderBy, getDocs,
} from 'firebase/firestore';
import type { DPShift } from '@/types';
import type { BulkWorkShiftInput } from '@/features/dp/shifts/schemas';
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
  updateShift: (shift: DPShift) => Promise<void>;
  applyShiftsBatch: (input: BulkWorkShiftInput) => Promise<void>;
  deleteShift: (shift: Pick<DPShift, 'id' | 'type'> | string) => Promise<void>;
}

export function useDPShifts(scheduleId: string | null): DPShiftsHookResult {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const updateShift = useCallback(async ({ id, ...data }: DPShift) => {
    if (!scheduleId) return;
    await saveWorkShiftRequest(scheduleId, id, 'PATCH', data as DPShift);
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  const applyShiftsBatch = useCallback(async (input: BulkWorkShiftInput) => {
    if (!scheduleId || input.shiftIds.length === 0) return;
    await authenticatedApiRequest(`/api/dp/schedules/${encodeURIComponent(scheduleId)}/shifts/bulk`, {
      method: 'POST',
      json: input,
      getIdToken: async () => auth.currentUser?.getIdToken() ?? null,
    });
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  const deleteShift = useCallback(async (shift: Pick<DPShift, 'id' | 'type'> | string) => {
    if (!scheduleId) return;
    const shiftId = typeof shift === 'string' ? shift : shift.id;
    await authenticatedApiRequest(
      `/api/dp/schedules/${encodeURIComponent(scheduleId)}/shifts/${encodeURIComponent(shiftId)}`,
      {
        method: 'DELETE',
        getIdToken: async () => auth.currentUser?.getIdToken() ?? null,
      },
    );
    await rebalanceGoalsForSchedule(scheduleId);
  }, [scheduleId]);

  return {
    shifts,
    loading,
    error,
    addShift,
    updateShift,
    applyShiftsBatch,
    deleteShift,
  };
}
