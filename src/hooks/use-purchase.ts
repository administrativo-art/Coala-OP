
"use client";

import { useContext } from 'react';
import { PurchaseContext, type PurchaseContextType } from '@/components/purchase-provider';

export const usePurchase = (): PurchaseContextType => {
  const context = useContext(PurchaseContext);
  if (context === undefined) {
    throw new Error('usePurchase must be used within a PurchaseProvider');
  }
  return context;
};
