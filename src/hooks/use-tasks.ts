
"use client";

import { useContext } from 'react';
import { TaskContext, type TaskContextType } from '@/components/task-provider';

export const useTasks = (): TaskContextType => {
  const context = useContext(TaskContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TaskProvider');
  }
  return context;
};
