
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type StockCount } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface StockCountContextType {
  counts: StockCount[];
  loading: boolean;
  addStockCount: (count: Omit<StockCount, 'id'>) => Promise<void>;
  deleteStockCount: (countId: string) => Promise<void>;
}

export const StockCountContext = createContext<StockCountContextType | undefined>(undefined);

export function StockCountProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockCounts"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const countsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockCount));
      setCounts(countsData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching stock counts from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addStockCount = useCallback(async (count: Omit<StockCount, 'id'>) => {
    try {
        await addDoc(collection(db, "stockCounts"), count);
    } catch(error) {
        console.error("Error adding stock count:", error);
    }
  }, []);


  const deleteStockCount = useCallback(async (countId: string) => {
    try {
        await deleteDoc(doc(db, "stockCounts", countId));
    } catch(error) {
        console.error("Error deleting stock count:", error);
        throw error;
    }
  }, []);

  const value: StockCountContextType = useMemo(() => ({
    counts,
    loading,
    addStockCount,
    deleteStockCount,
  }), [counts, loading, addStockCount, deleteStockCount]);

  return <StockCountContext.Provider value={value}>{children}</StockCountContext.Provider>;
}
