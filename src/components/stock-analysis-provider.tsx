
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type StockAnalysisReport } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, deleteDoc, doc, query, writeBatch, addDoc } from 'firebase/firestore';

export interface StockAnalysisContextType {
  history: StockAnalysisReport[];
  loading: boolean;
  addReport: (report: Omit<StockAnalysisReport, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  deleteReport: (reportId: string) => Promise<void>;
}

export const StockAnalysisContext = createContext<StockAnalysisContextType | undefined>(undefined);

export function StockAnalysisProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<StockAnalysisReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockAnalysisReports"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      if (querySnapshot.empty && !localStorage.getItem('stockAnalysis_seeded')) {
        console.log("No analysis reports found. Seeding default report...");
        const today = new Date();
        const dummyReport: Omit<StockAnalysisReport, 'id'> = {
          reportName: 'Relatório Semanal Quiosque Tirirical',
          createdAt: today.toISOString(),
          status: 'completed',
          summary: '3 produtos precisam de reposição em 2 quiosques.',
          results: [
            { productId: '1', productName: 'Leite Integral (1L)', kioskId: 'tirirical', kioskName: 'Quiosque Tirirical', currentStock: 15, idealStock: 50, needed: 35, purchaseSuggestion: 'Comprar 3 Caixas' },
            { productId: '2', productName: 'Chocolate em Pó (400g)', kioskId: 'tirirical', kioskName: 'Quiosque Tirirical', currentStock: 20, idealStock: 40, needed: 20, purchaseSuggestion: 'Comprar 1 Fardo' },
            { productId: '1', productName: 'Leite Integral (1L)', kioskId: 'joao-paulo', kioskName: 'Quiosque João Paulo', currentStock: 10, idealStock: 40, needed: 30, purchaseSuggestion: 'Comprar 3 Caixas' }
          ]
        };
        const batch = writeBatch(db);
        const docRef = doc(collection(db, "stockAnalysisReports"));
        batch.set(docRef, dummyReport);
        try {
            await batch.commit();
            localStorage.setItem('stockAnalysis_seeded', 'true');
        } catch(seedError) {
            console.error("Error seeding analysis report:", seedError);
        }
        return;
      }
      
      const historyData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockAnalysisReport));
      setHistory(historyData.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching analysis reports from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  const addReport = useCallback(async (report: Omit<StockAnalysisReport, 'id' | 'createdAt' | 'status'>) => {
    // This will be implemented later with the AI logic
    const newReport = {
      ...report,
      createdAt: new Date().toISOString(),
      status: 'processing' as const,
    }
    try {
      await addDoc(collection(db, "stockAnalysisReports"), newReport);
    } catch (error) {
      console.error("Error adding analysis report:", error);
    }
  }, []);

  const deleteReport = useCallback(async (reportId: string) => {
    try {
        await deleteDoc(doc(db, "stockAnalysisReports", reportId));
    } catch(error) {
        console.error("Error deleting analysis report:", error);
    }
  }, []);
  
  const value: StockAnalysisContextType = {
      history,
      loading,
      addReport,
      deleteReport
  };

  return <StockAnalysisContext.Provider value={value}>{children}</StockAnalysisContext.Provider>;
}
