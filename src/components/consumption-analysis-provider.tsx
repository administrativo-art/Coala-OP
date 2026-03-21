
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ConsumptionReport } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, getDocs, where } from 'firebase/firestore';

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
      const docRef = await addDoc(collection(db, "consumptionReports"), report);
      return docRef.id;
    } catch (error) {
      console.error("Error adding consumption report:", error);
      return null;
    }
  }, []);

  const deleteReport = useCallback(async (reportId: string) => {
    try {
        // 1. Deleta o relatório de consumo
        await deleteDoc(doc(db, "consumptionReports", reportId));

        // 2. Busca e deleta o salesReport vinculado, se existir
        const salesQuery = query(
          collection(db, "salesReports"),
          where("consumptionReportId", "==", reportId)
        );
        const salesSnap = await getDocs(salesQuery);
        
        if (!salesSnap.empty) {
            await Promise.all(salesSnap.docs.map(d => deleteDoc(d.ref)));
        }
    } catch(error) {
        console.error("Error deleting consumption report and linked sales report:", error);
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
