
"use client";

import { useContext } from 'react';
import { MonthlyScheduleContext, type MonthlyScheduleContextType } from '@/components/monthly-schedule-provider';

export const useMonthlySchedule = (): MonthlyScheduleContextType => {
  const context = useContext(MonthlyScheduleContext);
  if (context === undefined) {
    throw new Error('useMonthlySchedule must be used within a MonthlyScheduleProvider');
  }
  return context;
};
