
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type StockAuditSession } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query } from 'firebase/firestore';

export interface StockAuditContextType {
  auditSessions: StockAuditSession[];
  loading: boolean;
  addAuditSession: (session: Omit<StockAuditSession, 'id'>) => Promise<string | null>;
  updateAuditSession: (sessionId: string, updates: Partial<StockAuditSession>) => Promise<void>;
}

export const StockAuditContext = createContext<StockAuditContextType | undefined>(undefined);

export function StockAuditProvider({ children }: { children: React.ReactNode }) {
  const [auditSessions, setAuditSessions] = useState<StockAuditSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockAuditSessions"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const sessionsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockAuditSession));
      setAuditSessions(sessionsData.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching stock audit sessions from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addAuditSession = useCallback(async (session: Omit<StockAuditSession, 'id'>): Promise<string | null> => {
    try {
        const docRef = await addDoc(collection(db, "stockAuditSessions"), session);
        return docRef.id;
    } catch(error) {
        console.error("Error adding audit session:", error);
        return null;
    }
  }, []);

  const updateAuditSession = useCallback(async (sessionId: string, updates: Partial<StockAuditSession>) => {
    const sessionRef = doc(db, "stockAuditSessions", sessionId);
    try {
        await updateDoc(sessionRef, updates);
    } catch(error) {
        console.error("Error updating audit session:", error);
    }
  }, []);

  const value: StockAuditContextType = useMemo(() => ({
    auditSessions,
    loading,
    addAuditSession,
    updateAuditSession,
  }), [auditSessions, loading, addAuditSession, updateAuditSession]);

  return <StockAuditContext.Provider value={value}>{children}</StockAuditContext.Provider>;
}
