
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ConsumptionReport, type BaseProduct } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface ConsumptionAnalysisContextType {
  history: ConsumptionReport[];
  loading: boolean;
  addReport: (report: Omit<ConsumptionReport, 'id'>, allBaseProducts: BaseProduct[], allKiosks: any[]) => Promise<string | null>;
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
  
  const addReport = useCallback(async (
    report: Omit<ConsumptionReport, 'id'>, 
    allBaseProducts: BaseProduct[],
    allKiosks: any[]
    ) => {
    try {
      const batch = writeBatch(db);

      // 1. Add the new report
      const newReportRef = doc(collection(db, "consumptionReports"));
      batch.set(newReportRef, report);
      
      const updatedReports = [...history, { ...report, id: newReportRef.id }];
      const baseProductMap = new Map<string, BaseProduct>(allBaseProducts.map(bp => [bp.id, JSON.parse(JSON.stringify(bp))]));

      // 2. Recalculate stock levels for ALL base products
      for (const bp of baseProductMap.values()) {
        const newStockLevels: { [kioskId: string]: { min: number } } = {};
        
        // Preserve existing levels first
        if (bp.stockLevels) {
            for (const kioskId in bp.stockLevels) {
                newStockLevels[kioskId] = bp.stockLevels[kioskId];
            }
        }

        let totalNetworkConsumption = 0;

        // Calculate for each individual kiosk
        for (const k of allKiosks) {
            if (k.id === 'matriz') continue;

            const kioskReports = updatedReports.filter(r => r.kioskId === k.id);
            if (kioskReports.length === 0) continue;
            
            const totalKioskConsumption = kioskReports.reduce((sum, r) => {
                const item = r.results.find(res => res.baseProductId === bp.id);
                return sum + (item?.consumedQuantity || 0);
            }, 0);

            if (totalKioskConsumption > 0) {
              totalNetworkConsumption += totalKioskConsumption;
              const avgMonthlyConsumption = totalKioskConsumption / kioskReports.length;
              const dailyAvg = avgMonthlyConsumption / 30;
              const kioskMinStock = Math.ceil((dailyAvg * 7) + (dailyAvg * 5));
              if (kioskMinStock > 0) {
                  newStockLevels[k.id] = { min: kioskMinStock };
              }
            }
        }

        // Calculate for Matriz based on total network consumption
        if (totalNetworkConsumption > 0) {
            const totalMonthsWithConsumption = new Set(updatedReports.filter(r => r.results.some(item => item.baseProductId === bp.id)).map(r => `${r.year}-${r.month}`)).size;
            const avgTotalMonthlyConsumption = totalMonthsWithConsumption > 0 ? totalNetworkConsumption / totalMonthsWithConsumption : 0;
             if (avgTotalMonthlyConsumption > 0) {
                newStockLevels['matriz'] = { min: Math.ceil(avgTotalMonthlyConsumption) };
            }
        }

        // 3. Stage the update for the base product in the batch
        if (Object.keys(newStockLevels).length > 0) {
            const productRef = doc(db, "baseProducts", bp.id);
            batch.update(productRef, { stockLevels: newStockLevels });
        }
      }

      // 4. Commit all changes atomically
      await batch.commit();
      return newReportRef.id;

    } catch (error) {
      console.error("Error adding consumption report and updating stock levels:", error);
      return null;
    }
  }, [history]);

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
