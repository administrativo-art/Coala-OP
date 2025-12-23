
// This hook is no longer used as the team management module has been removed.
"use client";

import { useContext } from 'react';
import { MonthlyScheduleContext } from '@/components/monthly-schedule-provider';
import { type MonthlyScheduleContextType } from '@/types';

export const useMonthlySchedule = (): MonthlyScheduleContextType => {
  const context = useContext(MonthlyScheduleContext);
  if (context === undefined) {
    throw new Error('useMonthlySchedule must be used within a MonthlyScheduleProvider');
  }
  return context;
};
