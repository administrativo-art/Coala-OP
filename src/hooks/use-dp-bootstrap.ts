"use client";

import React from 'react';
import type { DPCalendar, DPSchedule, DPShiftDefinition, DPUnit, DPUnitGroup, DPVacationRecord } from '@/types';
import { useAuth } from '@/hooks/use-auth';

export type DPBootstrapPayload = {
  units: DPUnit[];
  unitGroups: DPUnitGroup[];
  shiftDefinitions: DPShiftDefinition[];
  schedules: DPSchedule[];
  vacations: DPVacationRecord[];
  calendars: DPCalendar[];
};

function normalizeSchedule(data: any): DPSchedule {
  return {
    ...data,
    month: Number(data.month),
    year: Number(data.year),
    shiftCount: Number(data.shiftCount ?? 0),
  } as DPSchedule;
}

export function useDPBootstrap() {
  const { firebaseUser } = useAuth();
  const [data, setData] = React.useState<DPBootstrapPayload>({
    units: [],
    unitGroups: [],
    shiftDefinitions: [],
    schedules: [],
    vacations: [],
    calendars: [],
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/dp/bootstrap', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ? `${res.status} - ${payload.error}` : `Falha ${res.status}`);
      }

      const schedules = ((payload.schedules ?? []) as any[]).map(normalizeSchedule);
      schedules.sort((a, b) => b.year - a.year || b.month - a.month);

      setData({
        units: (payload.units ?? []) as DPUnit[],
        unitGroups: (payload.unitGroups ?? []) as DPUnitGroup[],
        shiftDefinitions: (payload.shiftDefinitions ?? []) as DPShiftDefinition[],
        schedules,
        vacations: (payload.vacations ?? []) as DPVacationRecord[],
        calendars: (payload.calendars ?? []) as DPCalendar[],
      });
    } catch (err: any) {
      setError(err?.message ?? 'Falha ao carregar dados do DP.');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  React.useEffect(() => {
    load();
  }, [load]);

  return { ...data, loading, error, refresh: load };
}
