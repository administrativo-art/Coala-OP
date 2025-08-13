

"use client";

import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './use-auth';
import { useTasks } from './use-tasks';
import { type Task } from '@/types';

interface AllTasksContextType {
  allTasks: Task[];
  loading: boolean;
}

const AllTasksContext = createContext<AllTasksContextType>({
  allTasks: [],
  loading: true,
});

export const useAllTasks = () => useContext(AllTasksContext);

export const AllTasksProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { tasks, loading: tasksLoading } = useTasks();

  const loading = authLoading || tasksLoading;

  const allTasks = useMemo((): Task[] => {
    if (loading || !user) return [];

    const myTasks = tasks.filter(task => {
        const isMyTask = task.assigneeType === 'user' && task.assigneeId === user.id;
        const isMyProfileTask = task.assigneeType === 'profile' && task.assigneeId === user.profileId;
        const isMyApproval = task.approverType === 'user' && task.approverId === user.id;
        const isMyProfileApproval = task.approverType === 'profile' && task.approverId === user.profileId;

        return isMyTask || isMyProfileTask || isMyApproval || isMyProfileApproval;
    });

    return myTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  }, [user, tasks, loading]);
  
  const value = {
    allTasks,
    loading
  };

  return <AllTasksContext.Provider value={value}>{children}</AllTasksContext.Provider>;
};
