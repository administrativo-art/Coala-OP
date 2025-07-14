
"use client";

import { useContext } from 'react';
import { StockAnalysisProductsContext, type StockAnalysisProductsContextType } from '@/components/stock-analysis-products-provider';

export const useStockAnalysisProducts = (): StockAnalysisProductsContextType => {
  const context = useContext(StockAnalysisProductsContext);
  if (context === undefined) {
    throw new Error('useStockAnalysisProducts must be used within a StockAnalysisProductsProvider');
  }
  return context;
};
