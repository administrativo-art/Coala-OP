
"use client";

import { useContext } from 'react';
import { ProductSimulationCategoryContext, type ProductSimulationCategoryContextType } from '@/components/product-simulation-category-provider';

export const useProductSimulationCategories = (): ProductSimulationCategoryContextType => {
  const context = useContext(ProductSimulationCategoryContext);
  if (context === undefined) {
    throw new Error('useProductSimulationCategories must be used within a ProductSimulationCategoryProvider');
  }
  return context;
};
