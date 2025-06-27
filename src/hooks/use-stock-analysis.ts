
"use client";

import { useContext } from 'react';
import { StockAnalysisContext, type StockAnalysisContextType } from '@/components/stock-analysis-provider';

export const useStockAnalysis = (): StockAnalysisContextType => {
  const context = useContext(StockAnalysisContext);
  if (context === undefined) {
    throw new Error('useStockAnalysis must be used within a StockAnalysisProvider');
  }
  return context;
};
