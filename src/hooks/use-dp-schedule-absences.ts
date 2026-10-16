"use client";

import { useCallback, useEffect, useState } from 'react';

import { fetchScheduleAbsences, subscribeToDPScheduleShiftChanges } from '@/features/dp/schedules/client';
import type { DPScheduleAbsence } from '@/types';

export function useDPScheduleAbsences(scheduleId: string | null) {
  const [absences, setAbsences] = useState<DPScheduleAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!scheduleId) {
      setAbsences([]); setLoading(false); setError(null); return;
    }
    setLoading(true); setError(null);
    try {
      setAbsences(await fetchScheduleAbsences(scheduleId));
    } catch {
      setError('Não foi possível carregar as ausências da escala.');
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);
  useEffect(() => {
    void load();
    return subscribeToDPScheduleShiftChanges(scheduleId ? [scheduleId] : [], () => { void load(); });
  }, [load, scheduleId]);
  return { absences, loading, error, refresh: load };
}
