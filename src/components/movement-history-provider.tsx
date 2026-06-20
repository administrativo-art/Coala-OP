

"use client";

import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { type MovementRecord } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, doc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export interface MovementHistoryContextType {
  history: MovementRecord[];
  loading: boolean;
  loaded: boolean;
  loadHistory: () => void;
  deleteMovementRecord: (movementId: string) => Promise<void>;
}

export const MovementHistoryContext = createContext<MovementHistoryContextType | undefined>(undefined);

export function MovementHistoryProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions } = useAuth();
  const [history, setHistory] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [requested, setRequested] = useState(false);
  const canViewPurchasingModule = canViewPurchasing(permissions);
  const eagerLoad =
    pathname?.startsWith('/dashboard/stock/analysis/movement-analysis') ||
    pathname?.startsWith('/dashboard/stock/analysis/valuation');
  const loadHistory = useCallback(() => setRequested(true), []);

  useEffect(() => {
    const canRead =
      permissions?.stock?.inventoryControl?.viewHistory ||
      permissions?.stock?.analysis?.valuation ||
      canViewPurchasingModule;
    if (!canRead) {
      setHistory([]);
      setLoading(false);
      setLoaded(false);
      return;
    }
    if (!eagerLoad && !requested) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, "movementHistory"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const historyData = querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as MovementRecord))
        .filter((movement) => movement.itemClass !== 'uniform');
      setHistory(historyData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      setLoading(false);
      setLoaded(true);
    }, (error) => {
        console.error("Error fetching movement history from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [canViewPurchasingModule, eagerLoad, requested, permissions?.stock?.analysis?.valuation, permissions?.stock?.inventoryControl?.viewHistory]);

  useEffect(() => {
    setRequested(false);
  }, [pathname]);

  const deleteMovementRecord = useCallback(async (movementId: string) => {
      try {
          await deleteDoc(doc(db, "movementHistory", movementId));
      } catch (error) {
          console.error("Error deleting movement record:", error);
          throw error;
      }
  }, []);

  const value: MovementHistoryContextType = useMemo(() => ({
      history,
      loading,
      loaded,
      loadHistory,
      deleteMovementRecord,
  }), [history, loading, loaded, loadHistory, deleteMovementRecord]);

  return <MovementHistoryContext.Provider value={value}>{children}</MovementHistoryContext.Provider>;
}
