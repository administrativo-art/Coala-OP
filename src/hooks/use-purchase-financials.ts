import { useContext } from 'react';
import {
  PurchaseFinancialContext,
  type PurchaseFinancialContextType,
} from '@/components/purchase-financial-provider';

export const usePurchaseFinancials = (): PurchaseFinancialContextType => {
  const ctx = useContext(PurchaseFinancialContext);
  if (!ctx) throw new Error('usePurchaseFinancials must be used within a PurchaseFinancialProvider');
  return ctx;
};
