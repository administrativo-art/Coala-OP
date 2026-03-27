"use client";

import React, { createContext, useContext } from 'react';
import { type SalesReport } from '@/types';

export interface SalesReportContextType {
  salesReports: SalesReport[];
  loading: boolean;
  addSalesReport: (report: Omit<SalesReport, 'id'>) => Promise<string | null>;
  deleteSalesReport: (id: string) => Promise<void>;
}

const CONTEXT_KEY = 'SalesContext_Global_Reference';

let ContextImpl = (globalThis as any)[CONTEXT_KEY] as React.Context<SalesReportContextType | undefined>;
if (!ContextImpl) {
  ContextImpl = createContext<SalesReportContextType | undefined>(undefined);
  (globalThis as any)[CONTEXT_KEY] = ContextImpl;
}

export const SalesReportContext = ContextImpl;

export const useSalesReports = (): SalesReportContextType => {
  const context = useContext(SalesReportContext);
  if (!context) throw new Error('useSalesReports must be used within a SalesReportProvider');
  return context;
};
