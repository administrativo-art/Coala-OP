import { useContext } from 'react';
import { PurchaseOrderContext, type PurchaseOrderContextType } from '@/components/purchase-order-provider';

export const usePurchaseOrders = (): PurchaseOrderContextType => {
  const ctx = useContext(PurchaseOrderContext);
  if (!ctx) throw new Error('usePurchaseOrders must be used within a PurchaseOrderProvider');
  return ctx;
};
