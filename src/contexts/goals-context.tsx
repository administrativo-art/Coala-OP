"use client";

import { createContext, useContext } from 'react';
import { type GoalTemplate, type GoalPeriodDoc, type EmployeeGoal } from '@/types';

export interface GoalsContextType {
  templates: GoalTemplate[];
  periods: GoalPeriodDoc[];
  employeeGoals: EmployeeGoal[];
  loading: boolean;
  addTemplate: (data: Omit<GoalTemplate, 'id' | 'createdAt'>) => Promise<string | null>;
  updateTemplate: (id: string, data: Partial<GoalTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  addPeriod: (data: Omit<GoalPeriodDoc, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string | null>;
  updatePeriod: (id: string, data: Partial<GoalPeriodDoc>) => Promise<void>;
  deletePeriod: (id: string) => Promise<void>;
  closePeriod: (id: string, status: 'closed' | 'cancelled', closureNote: string, closedBy: string) => Promise<void>;
  reopenPeriod: (id: string) => Promise<void>;
  addEmployeeGoal: (data: Omit<EmployeeGoal, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string | null>;
  deleteEmployeeGoal: (id: string) => Promise<void>;
}

export const GoalsContext = createContext<GoalsContextType | undefined>(undefined);

export const useGoals = (): GoalsContextType => {
  const context = useContext(GoalsContext);
  if (!context) throw new Error('useGoals must be used within a GoalsProvider');
  return context;
};
