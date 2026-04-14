"use client";

import { createContext, useContext } from 'react';
import type {
  DPUnit, DPUnitGroup, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar, DPHoliday,
} from '@/types';

export interface DPContextType {
  // Unidades
  units: DPUnit[];
  unitGroups: DPUnitGroup[];
  unitsLoading: boolean;
  addUnit: (data: Omit<DPUnit, 'id' | 'createdAt'>) => Promise<void>;
  updateUnit: (unit: DPUnit) => Promise<void>;
  deleteUnit: (unitId: string) => Promise<void>;
  addUnitGroup: (data: Omit<DPUnitGroup, 'id' | 'createdAt'>) => Promise<void>;
  updateUnitGroup: (group: DPUnitGroup) => Promise<void>;
  deleteUnitGroup: (groupId: string) => Promise<void>;

  // Definições de turno
  shiftDefinitions: DPShiftDefinition[];
  shiftDefsLoading: boolean;
  addShiftDefinition: (data: Omit<DPShiftDefinition, 'id' | 'createdAt'>) => Promise<void>;
  updateShiftDefinition: (def: DPShiftDefinition) => Promise<void>;
  deleteShiftDefinition: (defId: string) => Promise<void>;

  // Escalas
  schedules: DPSchedule[];
  schedulesLoading: boolean;
  addSchedule: (data: Omit<DPSchedule, 'id' | 'createdAt' | 'shiftCount'>) => Promise<string>;
  updateSchedule: (schedule: DPSchedule) => Promise<void>;
  deleteSchedule: (scheduleId: string) => Promise<void>;

  // Férias
  vacations: DPVacationRecord[];
  vacationsLoading: boolean;
  addVacation: (data: Omit<DPVacationRecord, 'id' | 'createdAt'>) => Promise<void>;
  updateVacation: (vacation: DPVacationRecord) => Promise<void>;
  deleteVacation: (vacationId: string) => Promise<void>;

  // Calendários
  calendars: DPCalendar[];
  calendarsLoading: boolean;
  addCalendar: (data: Omit<DPCalendar, 'id' | 'createdAt' | 'holidayCount'>) => Promise<string>;
  updateCalendar: (calendar: DPCalendar) => Promise<void>;
  deleteCalendar: (calendarId: string) => Promise<void>;
  addHoliday: (calendarId: string, data: Omit<DPHoliday, 'id' | 'createdAt'>) => Promise<void>;
  deleteHoliday: (calendarId: string, holidayId: string) => Promise<void>;
}

// Singleton pattern for Context to prevent hydration/chunking mismatches in Next.js
const _DP_KEY = '__COALA_DP_CONTEXT__';
const _store = typeof window !== 'undefined' ? (window as any) : (global as any);

// Explicitly type the context to avoid 'ServerContextJSONValue' inference issues
export const DPContext: React.Context<DPContextType | undefined> = 
  _store[_DP_KEY] || (_store[_DP_KEY] = createContext<DPContextType | undefined>(undefined));

export const useDP = (): DPContextType => {
  const context = useContext(DPContext);
  
  if (!context) {
    throw new Error(
      'useDP must be used within a DPProvider. If this happens in production, ensure you are not importing DPContext from multiple locations and that DPProvider is higher in the tree.'
    );
  }
  
  return context as DPContextType;
};
