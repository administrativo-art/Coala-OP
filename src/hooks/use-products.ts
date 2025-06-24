"use client";

import { useContext } from 'react';
import { ProductsContext, type ProductsContextType } from '@/components/products-provider';

export const useProducts = (): ProductsContextType => {
  const context = useContext(ProductsContext);
  if (context === undefined) {
    throw new Error('useProducts must be used within a ProductsProvider');
  }
  return context;
};
