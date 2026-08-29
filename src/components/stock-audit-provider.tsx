
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type StockAuditSession } from '@/types';
import { db } from '@/lib/firebase';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { OWN_OPEN_STOCK_COUNT_SESSION_LIMIT } from '@/features/stock-count/lib/visibility';

export interface StockAuditContextType {
  auditSessions: StockAuditSession[];
  activeSession: StockAuditSession | null;
  hasMoreOpenSessions: boolean;
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
  const [hasMoreOpenSessions, setHasMoreOpenSessions] = useState(false);
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const canReadStockAudit = isDefaultAdmin ||
    permissions.stock.stockCount.view ||
    permissions.stock.audit.view;

  useEffect(() => {
    if (!firebaseUser || !canReadStockAudit) {
      setAuditSessions([]);
      setActiveSession(null);
      setHasMoreOpenSessions(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Este provider global atende somente a fila operacional. O filtro por status
    // evita recarregar todo o histórico concluído em cada sessão autenticada.
    const q = query(
      collection(db, "stockAuditSessions"),
      where("status", "==", "pending_review"),
      where("auditedBy.userId", "==", firebaseUser.uid),
      limit(OWN_OPEN_STOCK_COUNT_SESSION_LIMIT + 1),
    );
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
      const orderedSessions = sessionsData.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      const visibleSessions = orderedSessions.slice(0, OWN_OPEN_STOCK_COUNT_SESSION_LIMIT);
      setHasMoreOpenSessions(orderedSessions.length > OWN_OPEN_STOCK_COUNT_SESSION_LIMIT);
      setAuditSessions(visibleSessions);
      
      // Update active session if it exists in the new data
      setActiveSession((current) =>
        current ? visibleSessions.find((session) => session.id === current.id) ?? null : null
      );
      
      setLoading(false);
    }, (error) => {
        console.error("Error fetching stock audit sessions from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [canReadStockAudit, firebaseUser]);

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
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? 'Falha ao atualizar sessão de auditoria.');
        }
    } catch(error) {
        console.error("Error updating audit session:", error);
        throw error;
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
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? 'Falha ao deletar sessão de auditoria.');
        }
        if (activeSession?.id === sessionId) {
            setActiveSession(null);
        }
    } catch (error) {
      console.error("Error deleting audit session:", error);
      throw error;
    }
  }, [activeSession, firebaseUser]);

  const value: StockAuditContextType = useMemo(() => ({
    auditSessions,
    activeSession,
    hasMoreOpenSessions,
    loading,
    setActiveSession,
    addAuditSession,
    updateAuditSession,
    deleteAuditSession,
  }), [auditSessions, activeSession, hasMoreOpenSessions, loading, setActiveSession, addAuditSession, updateAuditSession, deleteAuditSession]);

  return <StockAuditContext.Provider value={value}>{children}</StockAuditContext.Provider>;
}
