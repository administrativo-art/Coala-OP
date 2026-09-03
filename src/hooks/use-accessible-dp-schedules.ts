"use client";

import { useMemo } from 'react';
import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { canAccessUnit, resolveUnitAccess } from '@/lib/unit-access';
import type { DPSchedule } from '@/types';

// Schedules visible to the current user, applying the same per-unit access
// rules used across the DP schedules list, editor and month view.
export function useAccessibleDPSchedules(): DPSchedule[] {
  const { schedules } = useDP();
  const { user, isDefaultAdmin } = useAuth();

  return useMemo(() => {
    if (!user) return [];
    const access = resolveUnitAccess(user, { isDefaultAdmin });
    return schedules.filter((schedule) =>
      schedule.unitId
        ? canAccessUnit(user, schedule.unitId, { isDefaultAdmin })
        : access.allUnits
    );
  }, [isDefaultAdmin, schedules, user]);
}
