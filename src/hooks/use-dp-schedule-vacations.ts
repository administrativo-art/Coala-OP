"use client";

import { useEffect, useState } from 'react';

import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import type { DPVacationRecord } from '@/types';

type ScheduleVacationsResponse = {
  vacations: DPVacationRecord[];
};

export function useDPScheduleVacations(scheduleId: string) {
  const request = useAuthenticatedApi();
  const [vacations, setVacations] = useState<DPVacationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setVacations([]);
    setLoading(true);
    setError(null);

    void request<ScheduleVacationsResponse>(
      `/api/dp/schedules/${encodeURIComponent(scheduleId)}/vacations`,
      {
        signal: controller.signal,
        fallbackError: 'Falha ao validar as férias da escala.',
      },
    ).then((payload) => {
      if (!active) return;
      setVacations(Array.isArray(payload.vacations) ? payload.vacations : []);
      setLoading(false);
    }).catch(() => {
      if (!active || controller.signal.aborted) return;
      setError('Não foi possível validar as férias da escala.');
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [request, scheduleId]);

  return { vacations, loading, error };
}
