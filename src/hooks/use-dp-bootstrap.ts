"use client";

import React from 'react';
import type {
  DPCalendar,
  DPSchedule,
  DPShiftDefinition,
  DPUnit,
  DPUnitGroup,
  DPVacationRecord,
} from '@/types';
import { useDP } from '@/components/dp-context';

export type DPBootstrapPayload = {
  units: DPUnit[];
  unitGroups: DPUnitGroup[];
  shiftDefinitions: DPShiftDefinition[];
  schedules: DPSchedule[];
  vacations: DPVacationRecord[];
  calendars: DPCalendar[];
};

export function useDPBootstrap() {
  const {
    units,
    unitGroups,
    shiftDefinitions,
    schedules,
    vacations,
    calendars,
    unitsLoading,
    shiftDefsLoading,
    schedulesLoading,
    vacationsLoading,
    calendarsLoading,
    bootstrapError,
  } = useDP();

  const loading =
    unitsLoading ||
    shiftDefsLoading ||
    schedulesLoading ||
    vacationsLoading ||
    calendarsLoading;

  const refresh = React.useCallback(async () => {
    // Kept for backwards compatibility with older callers.
    // DP data now comes from the shared client store subscriptions.
  }, []);

  return {
    units,
    unitGroups,
    shiftDefinitions,
    schedules,
    vacations,
    calendars,
    loading,
    error: bootstrapError,
    refresh,
  };
}
