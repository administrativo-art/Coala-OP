
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type ConsumptionReport } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

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
      // Seed data if the collection is empty
      if (querySnapshot.empty && !localStorage.getItem('consumptionReports_seeded')) {
        console.log("No consumption reports found. Seeding default report...");
        const today = new Date();
        const dummyReport: Omit<ConsumptionReport, 'id'> = {
          reportName: 'Vendas de Maio de 2024.pdf',
          month: 5,
          year: 2024,
          kioskId: 'tirirical',
          kioskName: 'Quiosque Tirirical',
          createdAt: today.toISOString(),
          status: 'completed',
          results: [
            { productId: 'some-id-1', productName: 'Bebida Láctea Baunilha (2L)', consumedQuantity: 150, consumedPackages: 75 },
            { productId: 'some-id-2', productName: 'Leite Integral (1L)', consumedQuantity: 240, consumedPackages: 240 },
          ]
        };
        const batch = writeBatch(db);
        const docRef = doc(collection(db, "consumptionReports"));
        batch.set(docRef, dummyReport);
        try {
            await batch.commit();
            localStorage.setItem('consumptionReports_seeded', 'true');
        } catch(seedError) {
            console.error("Error seeding consumption report:", seedError);
        }
        return;
      }
      
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
        await deleteDoc(doc(db, "consumptionReports", reportId));
    } catch(error) {
        console.error("Error deleting consumption report:", error);
        throw error;
    }
  }, []);
  
  const value: ConsumptionAnalysisContextType = {
      history,
      loading,
      addReport,
      deleteReport
  };

  return <ConsumptionAnalysisContext.Provider value={value}>{children}</ConsumptionAnalysisContext.Provider>;
}
