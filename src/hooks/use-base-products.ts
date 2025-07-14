
"use client";

import { useContext } from 'react';
import { BaseProductsContext, type BaseProductsContextType } from '@/components/base-products-provider';

export const useBaseProducts = (): BaseProductsContextType => {
  const context = useContext(BaseProductsContext);
  if (context === undefined) {
    throw new Error('useBaseProducts must be used within a BaseProductsProvider');
  }
  return context;
};
