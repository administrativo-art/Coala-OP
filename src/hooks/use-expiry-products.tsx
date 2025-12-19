
"use client";

import { useContext } from 'react';
import { ExpiryProductsContext, type ExpiryProductsContextType } from '@/components/expiry-products-provider';

export const useExpiryProducts = (): ExpiryProductsContextType => {
  const context = useContext(ExpiryProductsContext);
  if (context === undefined) {
    throw new Error('useExpiryProducts must be used within a ExpiryProductsProvider');
  }
  return context;
};
