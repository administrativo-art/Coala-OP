

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type StockAuditSession } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, deleteDoc } from 'firebase/firestore';

export interface StockAuditContextType {
  auditSessions: StockAuditSession[];
  activeSession: StockAuditSession | null;
  loading: boolean;
  setActiveSession: (session: StockAuditSession | null) => void;
  addAuditSession: (session: Omit<StockAuditSession, 'id'>) => Promise<string | null>;
  updateAuditSession: (sessionId: string, updates: Partial<StockAuditSession>) => Promise<void>;
  deleteAuditSession: (sessionId: string) => Promise<void>;
}

export const StockAuditContext = createContext<StockAuditContextType | undefined>(undefined);

export function StockAuditProvider({ children }: { children: React.ReactNode }) {
  const [auditSessions, setAuditSessions] = useState<StockAuditSession[]>([]);
  const [activeSession, setActiveSession] = useState<StockAuditSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockAuditSessions"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const sessionsData = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return { 
              id: doc.id,
              ...data,
              items: data.items.map((item: any) => ({
                ...item,
                countedQuantity: item.countedQuantity ?? item.systemQuantity,
                divergences: item.divergences || []
              }))
          } as StockAuditSession
      });
      setAuditSessions(sessionsData.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()));
      
      // Update active session if it exists in the new data
      if (activeSession) {
          const updatedActive = sessionsData.find(s => s.id === activeSession.id);
          setActiveSession(updatedActive || null);
      }
      
      setLoading(false);
    }, (error) => {
        console.error("Error fetching stock audit sessions from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []); // Removed activeSession dependency to prevent loops

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
        // Update local state immediately for faster UI response
        setAuditSessions(prevSessions => 
            prevSessions.map(session => 
                session.id === sessionId ? { ...session, ...updates } : session
            )
        );
        if (activeSession?.id === sessionId) {
            setActiveSession(prevActive => prevActive ? { ...prevActive, ...updates } : null);
        }
        
        await updateDoc(sessionRef, updates);
    } catch(error) {
        console.error("Error updating audit session:", error);
        // Optionally revert state on error
        // (For now, we rely on the next onSnapshot update to correct it)
    }
  }, [activeSession]);

  const deleteAuditSession = useCallback(async (sessionId: string) => {
    const sessionRef = doc(db, "stockAuditSessions", sessionId);
    try {
      await deleteDoc(sessionRef);
      if (activeSession?.id === sessionId) {
          setActiveSession(null);
      }
    } catch (error) {
      console.error("Error deleting audit session:", error);
    }
  }, [activeSession]);

  const value: StockAuditContextType = useMemo(() => ({
    auditSessions,
    activeSession,
    loading,
    setActiveSession,
    addAuditSession,
    updateAuditSession,
    deleteAuditSession,
  }), [auditSessions, activeSession, loading, setActiveSession, addAuditSession, updateAuditSession, deleteAuditSession]);

  return <StockAuditContext.Provider value={value}>{children}</StockAuditContext.Provider>;
}
