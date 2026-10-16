"use client";

import { useCallback, useEffect, useState } from 'react';

import type { DPJourneyValidationResult } from '@/features/dp/journey-validation/core';
import {
  fetchScheduleJourneyValidation,
  subscribeToDPScheduleShiftChanges,
} from '@/features/dp/schedules/client';

export function useDPScheduleJourneyValidation(scheduleId: string | null) {
  const [validation, setValidation] = useState<DPJourneyValidationResult | null>(null);
  const [loading, setLoading] = useState(Boolean(scheduleId));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!scheduleId) {
      setValidation(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setValidation(await fetchScheduleJourneyValidation(scheduleId));
    } catch (cause) {
      setValidation(null);
      setError(cause instanceof Error ? cause.message : 'Não foi possível validar as jornadas da escala.');
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    void Promise.resolve().then(reload);
    return subscribeToDPScheduleShiftChanges(scheduleId ? [scheduleId] : [], () => { void reload(); });
  }, [reload, scheduleId]);

  return { validation, loading, error, reload };
}
