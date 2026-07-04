
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Task, type TaskProject, type TaskStatusDoc, type TaskSubproject } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import {
  createTask,
  createTaskProject,
  createTaskStatus,
  deleteTaskProject as deleteTaskProjectRequest,
  deleteTaskSubproject as deleteTaskSubprojectRequest,
  deleteTaskStatus as deleteTaskStatusRequest,
  deleteTask as deleteTaskRequest,
  fetchTasksBootstrap,
  updateTask as updateTaskRequest,
  updateTaskProject as updateTaskProjectRequest,
  createTaskSubproject,
  updateTaskSubproject as updateTaskSubprojectRequest,
  updateTaskStatus,
  updateTaskStatusDoc,
} from '@/features/tasks/lib/client';

export interface TaskContextType {
  tasks: Task[];
  projects: TaskProject[];
  subprojects: TaskSubproject[];
  statuses: TaskStatusDoc[];
  loading: boolean;
  addTask: (task: Omit<Task, 'id'>) => Promise<string | null>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  createProject: (input: { name: string; description?: string }) => Promise<string | null>;
  updateProject: (projectId: string, input: { name: string; description?: string }) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createSubproject: (input: { project_id: string; name: string; description?: string }) => Promise<string | null>;
  updateSubproject: (subprojectId: string, input: { name: string; description?: string; order?: number }) => Promise<void>;
  deleteSubproject: (subprojectId: string) => Promise<void>;
  createStatus: (input: {
    project_id: string;
    subproject_id: string;
    name: string;
    slug: string;
    category?: TaskStatusDoc['category'];
    is_initial?: boolean;
    is_terminal?: boolean;
    order?: number;
    color?: string | null;
  }) => Promise<string | null>;
  updateStatusDoc: (
    statusId: string,
    input: {
      project_id: string;
      subproject_id: string;
      name: string;
      slug: string;
      category?: TaskStatusDoc['category'];
      is_initial?: boolean;
      is_terminal?: boolean;
      order?: number;
      color?: string | null;
    }
  ) => Promise<void>;
  deleteStatusDoc: (statusId: string) => Promise<void>;
}

export const TaskContext = createContext<TaskContextType | undefined>(undefined);

export function TaskProvider({ children }: { children: React.ReactNode }) {
    const { firebaseUser } = useAuth();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [projects, setProjects] = useState<TaskProject[]>([]);
    const [subprojects, setSubprojects] = useState<TaskSubproject[]>([]);
    const [statuses, setStatuses] = useState<TaskStatusDoc[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        async function load() {
            if (!firebaseUser) return;
            try {
                const payload = await fetchTasksBootstrap(firebaseUser);
                if (isMounted) {
                    setProjects(payload.projects);
                    setSubprojects(payload.subprojects ?? []);
                    setStatuses(payload.statuses);
                    setTasks(payload.tasks);
                }
            } catch (error) {
                console.warn("Error fetching tasks:", error);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        load();
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load();
        }, 60000);

        return () => {
            isMounted = false;
            window.clearInterval(intervalId);
        };
    }, [firebaseUser]);

    const addTask = useCallback(async (task: Omit<Task, 'id'>): Promise<string | null> => {
        if (!firebaseUser) return null;
        try {
            const createdTask = await createTask(firebaseUser, {
                title: task.title,
                description: task.description,
                assigneeType: task.assigneeType,
                assigneeId: task.assigneeId || undefined,
                requiresApproval: task.requiresApproval,
                approverType: task.approverType,
                approverId: task.approverId || undefined,
                dueDate: task.dueDate,
                projectId: (task as Task & { projectId?: string }).projectId,
                subprojectId: (task as Task & { subprojectId?: string }).subprojectId,
                subprojectName: (task as Task & { subprojectName?: string }).subprojectName,
                origin:
                    task.origin.kind === 'manual' || task.origin.kind === 'legacy'
                        ? task.origin
                        : undefined,
            });
            setTasks((current) => [createdTask, ...current]);
            return createdTask.id;
        } catch (error) {
            console.error("Error adding task:", error);
            return null;
        }
    }, [firebaseUser]);

    const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
        if (!firebaseUser) return;
        try {
            const shouldUseStatusRoute =
                typeof updates.status === 'string' &&
                Object.keys(updates).every((key) =>
                    key === 'status' ||
                    key === 'history' ||
                    key === 'updatedAt' ||
                    key === 'completedAt'
                );

            const statusDetails = Array.isArray(updates.history)
                ? updates.history[updates.history.length - 1]?.details
                : undefined;

            const updatedTask = shouldUseStatusRoute
                ? await updateTaskStatus(firebaseUser, taskId, updates.status as Task['status'], statusDetails)
                : await updateTaskRequest(firebaseUser, taskId, updates);

            setTasks((current) =>
                current.map((task) => (task.id === taskId ? updatedTask : task))
            );
        } catch (error) {
            console.error("Error updating task:", error);
        }
    }, [firebaseUser]);

    const deleteTask = useCallback(async (taskId: string) => {
        if (!firebaseUser) return;
        try {
            await deleteTaskRequest(firebaseUser, taskId);
            setTasks((current) => current.filter((task) => task.id !== taskId));
        } catch (error) {
            console.error("Error deleting task:", error);
        }
    }, [firebaseUser]);

    const createProject = useCallback(async (input: { name: string; description?: string }) => {
        if (!firebaseUser) return null;
        try {
            const response = await createTaskProject(firebaseUser, input);
            setProjects((current) =>
                [...current, response.project].sort((left, right) => left.name.localeCompare(right.name))
            );
            return response.project.id;
        } catch (error) {
            console.error("Error creating project:", error);
            return null;
        }
    }, [firebaseUser]);

    const updateProject = useCallback(async (projectId: string, input: { name: string; description?: string }) => {
        if (!firebaseUser) return;
        try {
            const response = await updateTaskProjectRequest(firebaseUser, projectId, input);
            setProjects((current) =>
                current
                    .map((project) => (project.id === projectId ? response.project : project))
                    .sort((left, right) => left.name.localeCompare(right.name))
            );
        } catch (error) {
            console.error("Error updating project:", error);
        }
    }, [firebaseUser]);

    const deleteProject = useCallback(async (projectId: string) => {
        if (!firebaseUser) return;
        try {
            await deleteTaskProjectRequest(firebaseUser, projectId);
            setProjects((current) => current.filter((project) => project.id !== projectId));
            setSubprojects((current) => current.filter((subproject) => subproject.project_id !== projectId));
            setStatuses((current) => current.filter((status) => status.project_id !== projectId));
        } catch (error) {
            console.error("Error deleting project:", error);
        }
    }, [firebaseUser]);

    const createSubproject = useCallback(async (input: { project_id: string; name: string; description?: string }) => {
        if (!firebaseUser) return null;
        try {
            const response = await createTaskSubproject(firebaseUser, input);
            setSubprojects((current) =>
                [...current, response.subproject].sort((left, right) => left.name.localeCompare(right.name))
            );
            if (response.statuses?.length) {
                setStatuses((current) =>
                    [...current, ...response.statuses!].sort((left, right) => left.order - right.order)
                );
            }
            return response.subproject.id;
        } catch (error) {
            console.error("Error creating subproject:", error);
            return null;
        }
    }, [firebaseUser]);

    const updateSubproject = useCallback(async (subprojectId: string, input: { name: string; description?: string; order?: number }) => {
        if (!firebaseUser) return;
        try {
            const response = await updateTaskSubprojectRequest(firebaseUser, subprojectId, input);
            setSubprojects((current) =>
                current
                    .map((subproject) => (subproject.id === subprojectId ? response.subproject : subproject))
                    .sort((left, right) => left.name.localeCompare(right.name))
            );
        } catch (error) {
            console.error("Error updating subproject:", error);
        }
    }, [firebaseUser]);

    const deleteSubproject = useCallback(async (subprojectId: string) => {
        if (!firebaseUser) return;
        try {
            await deleteTaskSubprojectRequest(firebaseUser, subprojectId);
            setSubprojects((current) => current.filter((subproject) => subproject.id !== subprojectId));
            setStatuses((current) => current.filter((status) => status.subproject_id !== subprojectId));
        } catch (error) {
            console.error("Error deleting subproject:", error);
        }
    }, [firebaseUser]);

    const createStatusDoc = useCallback(async (input: {
        project_id: string;
        subproject_id: string;
        name: string;
        slug: string;
        category?: TaskStatusDoc['category'];
        is_initial?: boolean;
        is_terminal?: boolean;
        order?: number;
        color?: string | null;
    }) => {
        if (!firebaseUser) return null;
        try {
            const response = await createTaskStatus(firebaseUser, input);
            setStatuses((current) =>
                [...current, response.status].sort((left, right) => left.order - right.order)
            );
            return response.status.id;
        } catch (error) {
            console.error("Error creating status:", error);
            return null;
        }
    }, [firebaseUser]);

    const updateStatus = useCallback(async (statusId: string, input: {
        project_id: string;
        subproject_id: string;
        name: string;
        slug: string;
        category?: TaskStatusDoc['category'];
        is_initial?: boolean;
        is_terminal?: boolean;
        order?: number;
        color?: string | null;
    }) => {
        if (!firebaseUser) return;
        try {
            const response = await updateTaskStatusDoc(firebaseUser, statusId, input);
            setStatuses((current) =>
                current
                    .map((status) => (status.id === statusId ? response.status : status))
                    .sort((left, right) => left.order - right.order)
            );
        } catch (error) {
            console.error("Error updating status:", error);
        }
    }, [firebaseUser]);

    const deleteStatusDoc = useCallback(async (statusId: string) => {
        if (!firebaseUser) return;
        try {
            await deleteTaskStatusRequest(firebaseUser, statusId);
            setStatuses((current) => current.filter((status) => status.id !== statusId));
        } catch (error) {
            console.error("Error deleting status:", error);
        }
    }, [firebaseUser]);

    const value = useMemo(() => ({
        tasks,
        projects,
        subprojects,
        statuses,
        loading,
        addTask,
        updateTask,
        deleteTask,
        createProject,
        updateProject,
        deleteProject,
        createSubproject,
        updateSubproject,
        deleteSubproject,
        createStatus: createStatusDoc,
        updateStatusDoc: updateStatus,
        deleteStatusDoc,
    }), [
        tasks,
        projects,
        subprojects,
        statuses,
        loading,
        addTask,
        updateTask,
        deleteTask,
        createProject,
        updateProject,
        deleteProject,
        createSubproject,
        updateSubproject,
        deleteSubproject,
        createStatusDoc,
        updateStatus,
        deleteStatusDoc,
    ]);

    return (
        <TaskContext.Provider value={value}>
            {children}
        </TaskContext.Provider>
    );
}
