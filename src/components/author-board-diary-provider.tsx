
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type DailyLog } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, setDoc, query, where } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { format } from 'date-fns';

export interface AuthorBoardDiaryContextType {
  todayLog: DailyLog | null;
  loading: boolean;
  createOrUpdateLog: (logData: Partial<Omit<DailyLog, 'id'>>) => Promise<void>;
}

export const AuthorBoardDiaryContext = createContext<AuthorBoardDiaryContextType | undefined>(undefined);

export function AuthorBoardDiaryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [todayLog, setTodayLog] = useState<DailyLog | null>(null);
  const [loading, setLoading] = useState(true);

  const todayId = useMemo(() => {
    if (!user) return null;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return `${todayStr}_${user.id}`;
  }, [user]);

  useEffect(() => {
    if (!todayId) {
        setLoading(false);
        return;
    };

    const docRef = doc(db, "authorboarddiary", todayId);
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setTodayLog({ id: docSnap.id, ...docSnap.data() } as DailyLog);
      } else {
        setTodayLog(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching today's log:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [todayId]);

  const createOrUpdateLog = useCallback(async (logData: Partial<Omit<DailyLog, 'id'>>) => {
    if (!user || !todayId) throw new Error("Usuário não autenticado.");

    const now = new Date().toISOString();
    
    let payload: Partial<DailyLog>;

    if (todayLog) {
      // Update
      payload = {
        ...logData,
        updatedAt: now,
      };
    } else {
      // Create
      payload = {
        logDate: format(new Date(), 'yyyy-MM-dd'),
        author: {
          userId: user.id,
          username: user.username,
        },
        kioskIds: user.assignedKioskIds,
        createdAt: now,
        updatedAt: now,
        ...logData,
      };
    }

    try {
      await setDoc(doc(db, 'authorboarddiary', todayId), payload, { merge: true });
    } catch (error) {
      console.error("Error creating/updating log:", error);
    }
  }, [user, todayId, todayLog]);

  const value = useMemo(() => ({
    todayLog,
    loading,
    createOrUpdateLog,
  }), [todayLog, loading, createOrUpdateLog]);

  return (
    <AuthorBoardDiaryContext.Provider value={value}>
      {children}
    </AuthorBoardDiaryContext.Provider>
  );
}
