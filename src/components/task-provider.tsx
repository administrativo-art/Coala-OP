
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Task } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface TaskContextType {
  tasks: Task[];
  loading: boolean;
  addTask: (task: Omit<Task, 'id'>) => Promise<string | null>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
}

export const TaskContext = createContext<TaskContextType | undefined>(undefined);

export function TaskProvider({ children }: { children: React.ReactNode }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(collection(db, "tasks"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
            setTasks(data);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching tasks:", error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const addTask = useCallback(async (task: Omit<Task, 'id'>): Promise<string | null> => {
        try {
            const docRef = await addDoc(collection(db, "tasks"), task);
            return docRef.id;
        } catch (error) {
            console.error("Error adding task:", error);
            return null;
        }
    }, []);

    const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
        const taskRef = doc(db, "tasks", taskId);
        try {
            await updateDoc(taskRef, { ...updates, updatedAt: new Date().toISOString() });
        } catch (error) {
            console.error("Error updating task:", error);
        }
    }, []);

    const deleteTask = useCallback(async (taskId: string) => {
        try {
            await deleteDoc(doc(db, "tasks", taskId));
        } catch (error) {
            console.error("Error deleting task:", error);
        }
    }, []);

    const value = useMemo(() => ({
        tasks,
        loading,
        addTask,
        updateTask,
        deleteTask
    }), [tasks, loading, addTask, updateTask, deleteTask]);

    return (
        <TaskContext.Provider value={value}>
            {children}
        </TaskContext.Provider>
    );
}
