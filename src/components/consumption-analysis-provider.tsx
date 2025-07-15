
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ConsumptionReport } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';
import { useProducts } from '@/hooks/use-products'; // Import useProducts

export interface ConsumptionAnalysisContextType {
  history: ConsumptionReport[];
  loading: boolean;
  addReport: (report: Omit<ConsumptionReport, 'id'>) => Promise<string | null>;
  deleteReport: (reportId: string) => Promise<void>;
}

export const ConsumptionAnalysisContext = createContext<ConsumptionAnalysisContextType | undefined>(undefined);

export function ConsumptionAnalysisProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<ConsumptionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const { products } = useProducts(); // Get products

  useEffect(() => {
    const q = query(collection(db, "consumptionReports"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      const historyData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ConsumptionReport));
      setHistory(historyData.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching consumption reports from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  const addReport = useCallback(async (report: Omit<ConsumptionReport, 'id'>) => {
    try {
      const reportWithBaseIds = {
        ...report,
        results: report.results.map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            ...item,
            baseProductId: product?.baseProductId || null,
          };
        }),
      };
      const docRef = await addDoc(collection(db, "consumptionReports"), reportWithBaseIds);
      return docRef.id;
    } catch (error) {
      console.error("Error adding consumption report:", error);
      return null;
    }
  }, [products]);

  const deleteReport = useCallback(async (reportId: string) => {
    try {
        await deleteDoc(doc(db, "consumptionReports", reportId));
    } catch(error) {
        console.error("Error deleting consumption report:", error);
        throw error;
    }
  }, []);
  
  const value: ConsumptionAnalysisContextType = useMemo(() => ({
      history,
      loading,
      addReport,
      deleteReport
  }), [history, loading, addReport, deleteReport]);

  return <ConsumptionAnalysisContext.Provider value={value}>{children}</ConsumptionAnalysisContext.Provider>;
}
