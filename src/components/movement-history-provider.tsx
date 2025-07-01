
"use client";

import React, { createContext, useState, useEffect } from 'react';
import { type MovementRecord } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';

export interface MovementHistoryContextType {
  history: MovementRecord[];
  loading: boolean;
}

export const MovementHistoryContext = createContext<MovementHistoryContextType | undefined>(undefined);

export function MovementHistoryProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "movementHistory"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const historyData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MovementRecord));
      setHistory(historyData.sort((a, b) => new Date(b.movedAt).getTime() - new Date(a.movedAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching movement history from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const value: MovementHistoryContextType = {
      history,
      loading,
  };

  return <MovementHistoryContext.Provider value={value}>{children}</MovementHistoryContext.Provider>;
}
