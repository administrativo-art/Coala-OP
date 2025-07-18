
"use client";

import { useContext } from 'react';
import { ProductSimulationContext, type ProductSimulationContextType } from '@/components/product-simulation-provider';

export const useProductSimulation = (): ProductSimulationContextType => {
  const context = useContext(ProductSimulationContext);
  if (context === undefined) {
    throw new Error('useProductSimulation must be used within a ProductSimulationProvider');
  }
  return context;
};
