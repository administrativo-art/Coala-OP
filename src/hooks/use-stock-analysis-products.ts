
"use client";

import { useContext } from 'react';
import { ProductsContext, type ProductsContextType } from '@/components/products-provider';

// This hook is now an alias for useProducts to maintain compatibility in components during refactoring.
// It can be removed later and all usages replaced with useProducts.
export const useStockAnalysisProducts = (): ProductsContextType => {
  const context = useContext(ProductsContext);
  if (context === undefined) {
    throw new Error('useStockAnalysisProducts must be used within a ProductsProvider');
  }
  return context;
};
