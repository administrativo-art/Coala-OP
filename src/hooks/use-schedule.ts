
"use client";

import { useContext } from 'react';
import { ScheduleContext, type ScheduleContextType } from '@/components/schedule-provider';

export const useSchedule = (): ScheduleContextType => {
  const context = useContext(ScheduleContext);
  if (context === undefined) {
    throw new Error('useSchedule must be used within a ScheduleProvider');
  }
  return context;
};
