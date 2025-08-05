
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type DailyLog } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { format } from 'date-fns';

export interface AuthorBoardDiaryContextType {
  logs: DailyLog[];
  loading: boolean;
  getLogById: (logId: string) => DailyLog | undefined;
  createOrGetDailyLog: () => Promise<DailyLog | null>;
  updateLog: (logId: string, logData: Partial<Omit<DailyLog, 'id'>>) => Promise<void>;
  createOrUpdateLog: (logData: Partial<Omit<DailyLog, 'id'>>) => Promise<void>;
  deleteLog: (logId: string) => Promise<void>;
  todayLog: DailyLog | null;
}

export const AuthorBoardDiaryContext = createContext<AuthorBoardDiaryContextType | undefined>(undefined);

const cleanUndefined = (obj: any): any => {
    if (obj === null || obj === undefined) {
        return null;
    }
    if (Array.isArray(obj)) {
        return obj.map(v => cleanUndefined(v));
    }
    if (typeof obj === 'object') {
        return Object.entries(obj).reduce((acc, [key, value]) => {
            if (value !== undefined) {
                acc[key] = cleanUndefined(value);
            }
            return acc;
        }, {} as {[key: string]: any});
    }
    return obj;
}


export function AuthorBoardDiaryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (!user) {
        setLoading(false);
        setLogs([]);
        return;
    }

    const q = query(collection(db, "authorboarddiary"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyLog));
      setLogs(allLogs.sort((a,b) => new Date(b.logDate).getTime() - new Date(a.logDate).getTime()));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching logs:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const getLogById = useCallback((logId: string) => {
    return logs.find(log => log.id === logId);
  }, [logs]);

  const createOrGetDailyLog = useCallback(async (): Promise<DailyLog | null> => {
    if (!user) throw new Error("Usuário não autenticado.");

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const q = query(collection(db, "authorboarddiary"), where("author.userId", "==", user.id), where("logDate", "==", todayStr));

    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const existingDoc = querySnapshot.docs[0];
        return { id: existingDoc.id, ...existingDoc.data() } as DailyLog;
    }

    const now = new Date().toISOString();
    const newLogData: Omit<DailyLog, 'id'> = {
        logDate: todayStr,
        status: 'draft',
        author: {
            userId: user.id,
            username: user.username,
        },
        activities: [],
        createdAt: now,
        updatedAt: now,
    };
    
    try {
        const docRef = await addDoc(collection(db, 'authorboarddiary'), newLogData);
        return { id: docRef.id, ...newLogData };
    } catch (error) {
        console.error("Error creating new log:", error);
        return null;
    }
  }, [user]);
  
   const createOrUpdateLog = useCallback(async (logData: Partial<Omit<DailyLog, 'id'>>) => {
        if (!user) return null;
        
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const q = query(collection(db, "authorboarddiary"), where("logDate", "==", todayStr), where("author.userId", "==", user.id));
        const querySnapshot = await getDocs(q);

        const now = new Date().toISOString();
        const payload = { ...logData, updatedAt: now };

        if (!querySnapshot.empty) {
            const docRef = querySnapshot.docs[0].ref;
            await updateDoc(docRef, payload);
        } else {
            const newLog = {
                logDate: todayStr,
                status: 'draft',
                author: { userId: user.id, username: user.username },
                activities: [],
                createdAt: now,
                ...payload
            };
            await addDoc(collection(db, 'authorboarddiary'), newLog);
        }
    }, [user]);


  const updateLog = useCallback(async (logId: string, logData: Partial<Omit<DailyLog, 'id'>>) => {
    if (!user) throw new Error("Usuário não autenticado.");

    const now = new Date().toISOString();
    const payload = { ...logData, updatedAt: now };
    const cleanedPayload = cleanUndefined(payload);

    try {
      await setDoc(doc(db, 'authorboarddiary', logId), cleanedPayload, { merge: true });
    } catch (error) {
      console.error("Error updating log:", error);
      throw error;
    }
  }, [user]);
  
  const deleteLog = useCallback(async (logId: string) => {
    try {
        await deleteDoc(doc(db, 'authorboarddiary', logId));
    } catch (error) {
        console.error("Error deleting log:", error);
        throw error;
    }
  }, []);

  const todayLog = useMemo(() => {
    if (!user) return null;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return logs.find(log => log.author.userId === user.id && log.logDate === todayStr) || null;
  }, [logs, user]);

  const value = useMemo(() => ({
    logs,
    loading,
    getLogById,
    createOrGetDailyLog,
    updateLog,
    createOrUpdateLog,
    deleteLog,
    todayLog,
  }), [logs, loading, getLogById, createOrGetDailyLog, updateLog, createOrUpdateLog, deleteLog, todayLog]);

  return (
    <AuthorBoardDiaryContext.Provider value={value}>
      {children}
    </AuthorBoardDiaryContext.Provider>
  );
}
