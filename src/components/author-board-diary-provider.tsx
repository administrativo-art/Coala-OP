
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type DailyLog } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs, addDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { format } from 'date-fns';

export interface AuthorBoardDiaryContextType {
  logs: DailyLog[];
  loading: boolean;
  getLogById: (logId: string) => DailyLog | undefined;
  createOrGetDailyLog: () => Promise<DailyLog | null>;
  updateLog: (logId: string, logData: Partial<Omit<DailyLog, 'id'>>) => Promise<void>;
}

export const AuthorBoardDiaryContext = createContext<AuthorBoardDiaryContextType | undefined>(undefined);

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

    const q = query(collection(db, "authorboarddiary"), where("author.userId", "==", user.id));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyLog));
      setLogs(userLogs.sort((a,b) => new Date(b.logDate).getTime() - new Date(a.logDate).getTime()));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching user's logs:", error);
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
        status: 'aberto',
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

  const updateLog = useCallback(async (logId: string, logData: Partial<Omit<DailyLog, 'id'>>) => {
    if (!user) throw new Error("Usuário não autenticado.");

    const now = new Date().toISOString();
    const payload = { ...logData, updatedAt: now };

    try {
      await setDoc(doc(db, 'authorboarddiary', logId), payload, { merge: true });
    } catch (error) {
      console.error("Error updating log:", error);
      throw error;
    }
  }, [user]);

  const value = useMemo(() => ({
    logs,
    loading,
    getLogById,
    createOrGetDailyLog,
    updateLog,
  }), [logs, loading, getLogById, createOrGetDailyLog, updateLog]);

  return (
    <AuthorBoardDiaryContext.Provider value={value}>
      {children}
    </AuthorBoardDiaryContext.Provider>
  );
}
