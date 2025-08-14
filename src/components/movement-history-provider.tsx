

"use client";

import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import { type MovementRecord } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, doc, deleteDoc } from 'firebase/firestore';

export interface MovementHistoryContextType {
  history: MovementRecord[];
  loading: boolean;
  deleteMovementRecord: (movementId: string) => Promise<void>;
}

export const MovementHistoryContext = createContext<MovementHistoryContextType | undefined>(undefined);

export function MovementHistoryProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "movementHistory"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const historyData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MovementRecord));
      setHistory(historyData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching movement history from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

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
      deleteMovementRecord,
  }), [history, loading, deleteMovementRecord]);

  return <MovementHistoryContext.Provider value={value}>{children}</MovementHistoryContext.Provider>;
}
