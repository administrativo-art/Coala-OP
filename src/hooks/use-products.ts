

"use client";

import { useContext, useCallback } from 'react';
import { ProductsContext, type ProductsContextType } from '@/components/products-provider';
import { type Product } from '@/types';

interface UseProductsHook extends ProductsContextType {
    getProductFullName: (product: Product | null | undefined) => string;
}

export const useProducts = (): UseProductsHook => {
  const context = useContext(ProductsContext);
  if (context === undefined) {
    throw new Error('useProducts must be used within a ProductsProvider');
  }

  const getProductFullName = useCallback((product: Product | null | undefined) => {
    if (!product) return '';
    const brandPart = product.brand ? ` - ${product.brand}` : '';
    // Avoid showing "(1un)" for single items which is redundant
    const packagePart = (product.packageSize && product.unit && (product.packageSize !== 1 || (product.unit.toLowerCase() !== 'un' && product.unit.toLowerCase() !== 'unidade'))) 
      ? ` (${product.packageSize}${product.unit})` 
      : '';
    return `${product.baseName}${brandPart}${packagePart}`;
  }, []);

  return { ...context, getProductFullName };
};



