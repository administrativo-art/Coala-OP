"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { type SalesReport } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface SalesReportContextType {
  salesReports: SalesReport[];
  loading: boolean;
  addSalesReport: (report: Omit<SalesReport, 'id'>) => Promise<string | null>;
  deleteSalesReport: (id: string) => Promise<void>;
}

export const SalesReportContext = createContext<SalesReportContextType | undefined>(undefined);

export function SalesReportProvider({ children }: { children: React.ReactNode }) {
  const [salesReports, setSalesReports] = useState<SalesReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'salesReports'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SalesReport));
      setSalesReports(data.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      }));
      setLoading(false);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.error('Error fetching sales reports:', error);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addSalesReport = useCallback(async (report: Omit<SalesReport, 'id'>): Promise<string | null> => {
    try {
      const docRef = await addDoc(collection(db, 'salesReports'), report);
      return docRef.id;
    } catch (error) {
      console.error('Error adding sales report:', error);
      return null;
    }
  }, []);

  const deleteSalesReport = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, 'salesReports', id));
    } catch (error) {
      console.error('Error deleting sales report:', error);
    }
  }, []);

  const value = useMemo(() => ({
    salesReports,
    loading,
    addSalesReport,
    deleteSalesReport,
  }), [salesReports, loading, addSalesReport, deleteSalesReport]);

  return (
    <SalesReportContext.Provider value={value}>
      {children}
    </SalesReportContext.Provider>
  );
}

export const useSalesReports = (): SalesReportContextType => {
  const context = useContext(SalesReportContext);
  if (!context) throw new Error('useSalesReports must be used within a SalesReportProvider');
  return context;
};
