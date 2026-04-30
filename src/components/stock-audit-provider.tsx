
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type StockAuditSession } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';

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
  const { firebaseUser } = useAuth();
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
  }, []);

  const addAuditSession = useCallback(async (session: Omit<StockAuditSession, 'id'>): Promise<string | null> => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/registry/stock-audit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(session),
        });
        if (!response.ok) throw new Error('Falha ao criar sessão de auditoria.');
        const { id } = await response.json();
        return id;
    } catch(error) {
        console.error("Error adding audit session:", error);
        return null;
    }
  }, [firebaseUser]);

  const updateAuditSession = useCallback(async (sessionId: string, updates: Partial<StockAuditSession>) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch(`/api/registry/stock-audit/${sessionId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(updates),
        });
        if (!response.ok) throw new Error('Falha ao atualizar sessão de auditoria.');
    } catch(error) {
        console.error("Error updating audit session:", error);
    }
  }, [firebaseUser]);

  const deleteAuditSession = useCallback(async (sessionId: string) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch(`/api/registry/stock-audit/${sessionId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Falha ao deletar sessão de auditoria.');
        if (activeSession?.id === sessionId) {
            setActiveSession(null);
        }
    } catch (error) {
      console.error("Error deleting audit session:", error);
    }
  }, [activeSession, firebaseUser]);

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
