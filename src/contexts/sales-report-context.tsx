"use client";

import React, { createContext, useContext } from 'react';
import { type SalesReport } from '@/types';

export interface SalesReportContextType {
  salesReports: SalesReport[];
  loading: boolean;
  addSalesReport: (report: Omit<SalesReport, 'id'>) => Promise<string | null>;
  deleteSalesReport: (id: string) => Promise<void>;
}

export const SalesReportContext = createContext<SalesReportContextType | undefined>(undefined);

export const useSalesReports = (): SalesReportContextType => {
  const context = useContext(SalesReportContext);
  if (!context) throw new Error('useSalesReports must be used within a SalesReportProvider');
  return context;
};
