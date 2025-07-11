
"use client";

import { useContext } from 'react';
import { StockCountContext, type StockCountContextType } from '@/components/stock-count-provider';

export const useStockCount = (): StockCountContextType => {
  const context = useContext(StockCountContext);
  if (context === undefined) {
    throw new Error('useStockCount must be used within a StockCountProvider');
  }
  return context;
};
