import { useContext } from 'react';
import {
  PurchaseReceiptContext,
  type PurchaseReceiptContextType,
  type LotInput,
  type ReceiptItemInput,
  type StockEntryItemInput,
  type SaveConferencePayload,
  type ConfirmStockEntryPayload,
} from '@/components/purchase-receipt-provider';

export type { LotInput, ReceiptItemInput, StockEntryItemInput, SaveConferencePayload, ConfirmStockEntryPayload };

export const usePurchaseReceipts = (): PurchaseReceiptContextType => {
  const ctx = useContext(PurchaseReceiptContext);
  if (!ctx) throw new Error('usePurchaseReceipts must be used within a PurchaseReceiptProvider');
  return ctx;
};
