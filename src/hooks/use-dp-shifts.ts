"use client";

import { useState, useEffect, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, doc } from 'firebase/firestore';
import type { DPShift } from '@/types';
import type { BulkWorkShiftInput } from '@/features/dp/shifts/schemas';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import {
  fetchScheduleShifts,
  fetchDraftScheduleShifts,
  notifyDPScheduleShiftsChanged,
  subscribeToDPScheduleShiftChanges,
} from '@/features/dp/schedules/client';

export { notifyDPScheduleShiftsChanged } from '@/features/dp/schedules/client';

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
    ...(data.exceptionReason ? { exceptionReason: data.exceptionReason } : {}),
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
  draftVersion: number;
  conflicts: string[];
  reload: () => Promise<void>;
  addShift: (data: Omit<DPShift, 'id' | 'createdAt'>) => Promise<void>;
  updateShift: (shift: DPShift) => Promise<void>;
  applyShiftsBatch: (input: BulkWorkShiftInput) => Promise<void>;
  deleteShift: (shift: Pick<DPShift, 'id' | 'type'> | string) => Promise<void>;
}

export function useDPShifts(scheduleId: string | null, editable = false): DPShiftsHookResult {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const loadShifts = useCallback(async () => {
    if (!scheduleId) {
      setShifts([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (editable) {
        const draft = await fetchDraftScheduleShifts(scheduleId);
        setShifts(draft.shifts);
        setDraftVersion(draft.draftVersion);
        setConflicts(draft.conflicts);
      } else {
        setShifts(await fetchScheduleShifts(scheduleId));
        setDraftVersion(0);
        setConflicts([]);
      }
    } catch (loadError) {
      console.error('[useDPShifts] Secure fetch failed.', loadError);
      setError('Falha ao carregar os turnos da escala.');
    } finally {
      setLoading(false);
    }
  }, [scheduleId, editable]);

  useEffect(() => {
    void Promise.resolve().then(loadShifts);
    return subscribeToDPScheduleShiftChanges(scheduleId ? [scheduleId] : [], () => { void loadShifts(); });
  }, [loadShifts, scheduleId]);

  const addShift = useCallback(async (data: Omit<DPShift, 'id' | 'createdAt'>) => {
    if (!scheduleId) return;
    const shiftRef = doc(collection(db, 'dp_schedules', scheduleId, 'shifts'));
    await saveWorkShiftRequest(scheduleId, shiftRef.id, 'PUT', data);
    notifyDPScheduleShiftsChanged(scheduleId);
  }, [scheduleId]);

  const updateShift = useCallback(async ({ id, ...data }: DPShift) => {
    if (!scheduleId) return;
    await saveWorkShiftRequest(scheduleId, id, 'PATCH', data as DPShift);
    notifyDPScheduleShiftsChanged(scheduleId);
  }, [scheduleId]);

  const applyShiftsBatch = useCallback(async (input: BulkWorkShiftInput) => {
    if (!scheduleId) return;
    await authenticatedApiRequest(`/api/dp/schedules/${encodeURIComponent(scheduleId)}/shifts/bulk`, {
      method: 'POST',
      json: input,
      getIdToken: async () => auth.currentUser?.getIdToken() ?? null,
    });
    notifyDPScheduleShiftsChanged(scheduleId);
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
    notifyDPScheduleShiftsChanged(scheduleId);
  }, [scheduleId]);

  return {
    shifts,
    loading,
    error,
    draftVersion,
    conflicts,
    reload: loadShifts,
    addShift,
    updateShift,
    applyShiftsBatch,
    deleteShift,
  };
}
